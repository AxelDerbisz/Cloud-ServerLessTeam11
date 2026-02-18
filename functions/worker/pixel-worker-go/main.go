package pixelworker

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"log/slog"
	"math"
	"net/http"
	"os"
	"regexp"
	"strings"
	"sync"
	"time"

	"cloud.google.com/go/firestore"
	"cloud.google.com/go/pubsub"
	"github.com/GoogleCloudPlatform/functions-framework-go/functions"
	"github.com/cloudevents/sdk-go/v2/event"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	texporter "github.com/GoogleCloudPlatform/opentelemetry-operations-go/exporter/trace"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/trace"
)

const (
	rateLimitWindow = 60 // seconds
	rateLimitMax    = 20 // pixels per window
	maxCoordinate   = 100000
	discordAPI      = "https://discord.com/api/v10"
)

var (
	projectID        string
	discordBotToken  string
	publicPixelTopic string
	fsClient         *firestore.Client
	psClient         *pubsub.Client
	fsOnce           sync.Once
	psOnce           sync.Once
	hexColorRegex    = regexp.MustCompile(`^[0-9A-Fa-f]{6}$`)
	tracer           trace.Tracer
	tracerProvider   *sdktrace.TracerProvider
)

func init() {
	projectID = os.Getenv("PROJECT_ID")
	discordBotToken = strings.TrimSpace(os.Getenv("DISCORD_BOT_TOKEN"))
	publicPixelTopic = os.Getenv("PUBLIC_PIXEL_TOPIC")
	if publicPixelTopic == "" {
		publicPixelTopic = "public-pixel"
	}
	functions.CloudEvent("handler", handleCloudEvent)

	ctx := context.Background()
	exporter, err := texporter.New(texporter.WithProjectID(projectID))
	if err == nil {
		res, _ := resource.New(ctx,
			resource.WithFromEnv(),
			resource.WithTelemetrySDK(),
		)
		tracerProvider = sdktrace.NewTracerProvider(
			sdktrace.WithBatcher(exporter),
			sdktrace.WithResource(res),
		)
		otel.SetTracerProvider(tracerProvider)
	}
	tracer = otel.Tracer("pixel-worker")

	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		ReplaceAttr: func(groups []string, a slog.Attr) slog.Attr {
			if a.Key == slog.MessageKey {
				a.Key = "message"
			} else if a.Key == slog.LevelKey {
				a.Key = "severity"
			}
			return a
		},
	})))
}

func getFirestore() *firestore.Client {
	fsOnce.Do(func() {
		var err error
		fsClient, err = firestore.NewClientWithDatabase(context.Background(), projectID, "team11-database")
		if err != nil {
			log.Fatalf("Firestore client: %v", err)
		}
	})
	return fsClient
}

func getPubsub() *pubsub.Client {
	psOnce.Do(func() {
		var err error
		psClient, err = pubsub.NewClient(context.Background(), projectID)
		if err != nil {
			log.Fatalf("Pub/Sub client: %v", err)
		}
	})
	return psClient
}

// CloudEvent Pub/Sub data
type MessagePublishedData struct {
	Message struct {
		Data       []byte            `json:"data"`
		Attributes map[string]string `json:"attributes"`
	} `json:"message"`
}

type PixelEvent struct {
	X                int    `json:"x"`
	Y                int    `json:"y"`
	Color            string `json:"color"`
	UserID           string `json:"userId"`
	Username         string `json:"username"`
	Source           string `json:"source"`
	InteractionToken string `json:"interactionToken"`
	ApplicationID    string `json:"applicationId"`
}

func sendFollowUp(appID, token, content string) {
	if appID == "" || token == "" || discordBotToken == "" {
		return
	}
	body, _ := json.Marshal(map[string]string{"content": content})
	req, _ := http.NewRequest("POST", fmt.Sprintf("%s/webhooks/%s/%s", discordAPI, appID, token), bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bot "+discordBotToken)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return
	}
	resp.Body.Close()
}

func checkRateLimit(ctx context.Context, userID string) (bool, int) {
	ctx, span := tracer.Start(ctx, "checkRateLimit")
	defer span.End()

	span.SetAttributes(attribute.String("user.id", userID))

	now := time.Now()
	minute := now.Unix() / rateLimitWindow
	docID := fmt.Sprintf("%s_%d", userID, minute)
	ref := getFirestore().Collection("rate_limits").Doc(docID)

	allowed := true
	count := 0

	err := getFirestore().RunTransaction(ctx, func(ctx context.Context, tx *firestore.Transaction) error {
		doc, err := tx.Get(ref)
		if err != nil {
			// Document doesn't exist — create it
			tx.Set(ref, map[string]interface{}{
				"count":     1,
				"userId":    userID,
				"window":    minute,
				"expiresAt": now.Add(time.Duration(rateLimitWindow*2) * time.Second).Format(time.RFC3339),
			})
			allowed = true
			count = 1
			return nil
		}

		data := doc.Data()
		c := toInt(data["count"])
		if c >= rateLimitMax {
			allowed = false
			count = c
			return nil
		}

		tx.Update(ref, []firestore.Update{
			{Path: "count", Value: firestore.Increment(1)},
		})
		allowed = true
		count = c + 1
		return nil
	})

	if err != nil {
		return true, 0 // fail open
	}

	span.SetAttributes(
		attribute.Bool("rate_limit.allowed", allowed),
		attribute.Int("rate_limit.count", count),
	)
	return allowed, count
}

func validateBounds(ctx context.Context, x, y int) (bool, string) {
	doc, err := getFirestore().Collection("sessions").Doc("current").Get(ctx)
	if err != nil {
		return false, "No active session"
	}

	data := doc.Data()
	status, _ := data["status"].(string)
	if status != "active" {
		return false, fmt.Sprintf("Session is %s", status)
	}

	cw := toInt(data["canvasWidth"])
	ch := toInt(data["canvasHeight"])

	if cw > 0 && ch > 0 {
		if x < 0 || x >= cw || y < 0 || y >= ch {
			return false, fmt.Sprintf("Coordinates out of bounds (0-%d, 0-%d)", cw-1, ch-1)
		}
	}

	if int(math.Abs(float64(x))) > maxCoordinate || int(math.Abs(float64(y))) > maxCoordinate {
		return false, "Coordinates too large"
	}

	return true, ""
}

func updatePixel(ctx context.Context, x, y int, color, userID, username, source string) bool {
	ctx, span := tracer.Start(ctx, "updatePixel")
	defer span.End()

	span.SetAttributes(
		attribute.Int("pixel.x", x),
		attribute.Int("pixel.y", y),
		attribute.String("pixel.color", color),
		attribute.String("user.id", userID),
	)

	pixelID := fmt.Sprintf("%d_%d", x, y)
	pixelRef := getFirestore().Collection("pixels").Doc(pixelID)
	userRef := getFirestore().Collection("users").Doc(userID)
	now := time.Now().UTC().Format(time.RFC3339)

	err := getFirestore().RunTransaction(ctx, func(ctx context.Context, tx *firestore.Transaction) error {
		userDoc, err := tx.Get(userRef)

		// Set pixel
		tx.Set(pixelRef, map[string]interface{}{
			"x":         x,
			"y":         y,
			"color":     color,
			"userId":    userID,
			"username":  username,
			"source":    source,
			"updatedAt": now,
		})

		// Update user stats
		if err == nil && userDoc.Exists() {
			tx.Update(userRef, []firestore.Update{
				{Path: "lastPixelAt", Value: now},
				{Path: "pixelCount", Value: firestore.Increment(1)},
			})
		} else {
			tx.Set(userRef, map[string]interface{}{
				"id":          userID,
				"username":    username,
				"lastPixelAt": now,
				"pixelCount":  1,
				"createdAt":   now,
			})
		}
		return nil
	})

	if err != nil {
		span.SetAttributes(attribute.Bool("success", false))
		return false
	}
	span.SetAttributes(attribute.Bool("success", true))
	return true
}

func publishPixelUpdate(ctx context.Context, x, y int, color, userID, username string) {
	data, _ := json.Marshal(map[string]interface{}{
		"x":         x,
		"y":         y,
		"color":     color,
		"userId":    userID,
		"username":  username,
		"timestamp": time.Now().UTC().Format(time.RFC3339),
	})

	topic := getPubsub().Topic(publicPixelTopic)
	result := topic.Publish(ctx, &pubsub.Message{
		Data:       data,
		Attributes: map[string]string{"type": "pixel_update"},
	})

	result.Get(ctx)
}

func toInt(v interface{}) int {
	switch val := v.(type) {
	case int64:
		return int(val)
	case float64:
		return int(val)
	default:
		return 0
	}
}

func handleCloudEvent(ctx context.Context, e event.Event) error {
	var msg MessagePublishedData
	if err := e.DataAs(&msg); err != nil {
		return fmt.Errorf("parse event: %w", err)
	}

	// Extract trace context from Pub/Sub attributes
	if traceID := msg.Message.Attributes["traceId"]; traceID != "" {
		if spanID := msg.Message.Attributes["spanId"]; spanID != "" {
			tid, _ := trace.TraceIDFromHex(traceID)
			sid, _ := trace.SpanIDFromHex(spanID)
			parentCtx := trace.NewSpanContext(trace.SpanContextConfig{
				TraceID:    tid,
				SpanID:     sid,
				TraceFlags: trace.FlagsSampled,
				Remote:     true,
			})
			ctx = trace.ContextWithRemoteSpanContext(ctx, parentCtx)
		}
	}

	ctx, span := tracer.Start(ctx, "pixel_worker.handle_event")
	defer span.End()

	var ev PixelEvent
	if err := json.Unmarshal(msg.Message.Data, &ev); err != nil {
		return fmt.Errorf("parse pixel event: %w", err)
	}

	if ev.Source == "" {
		ev.Source = "web"
	}

	reply := func(msg string) {
		if ev.Source == "discord" {
			sendFollowUp(ev.ApplicationID, ev.InteractionToken, msg)
		}
	}

	// Validate color
	if !hexColorRegex.MatchString(ev.Color) {
		slog.Warn("pixel_validation_failed", "reason", "invalid_color", "color", ev.Color, "user_id", ev.UserID)
		reply(fmt.Sprintf("Invalid color format: %s. Use 6-digit hex (e.g., FF0000)", ev.Color))
		return nil
	}

	// Validate bounds
	valid, reason := validateBounds(ctx, ev.X, ev.Y)
	if !valid {
		slog.Warn("pixel_validation_failed", "reason", reason, "x", ev.X, "y", ev.Y, "user_id", ev.UserID)
		reply(reason)
		return nil
	}

	// Rate limit
	allowed, count := checkRateLimit(ctx, ev.UserID)
	if !allowed {
		slog.Warn("rate_limit_exceeded", "user_id", ev.UserID, "count", count, "max", rateLimitMax)
		reply(fmt.Sprintf("Rate limit exceeded (%d/%d per minute)", count, rateLimitMax))
		return nil
	}

	// Update pixel
	if !updatePixel(ctx, ev.X, ev.Y, ev.Color, ev.UserID, ev.Username, ev.Source) {
		slog.Error("pixel_placement_failed", "x", ev.X, "y", ev.Y, "user_id", ev.UserID)
		reply("Failed to place pixel")
		return nil
	}

	slog.Info("pixel_placed", "x", ev.X, "y", ev.Y, "color", ev.Color, "user_id", ev.UserID, "source", ev.Source)

	// Publish for real-time web updates
	publishPixelUpdate(ctx, ev.X, ev.Y, ev.Color, ev.UserID, ev.Username)

	reply(fmt.Sprintf("Pixel placed at (%d, %d) with color #%s", ev.X, ev.Y, ev.Color))

	// Flush traces before function exits (required for serverless)
	if tracerProvider != nil {
		tracerProvider.ForceFlush(ctx)
	}

	return nil
}
