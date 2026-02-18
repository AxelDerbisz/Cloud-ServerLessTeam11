package discordproxy

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"cloud.google.com/go/pubsub"
	"github.com/GoogleCloudPlatform/functions-framework-go/functions"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracegrpc"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/trace"
)

var (
	projectID           string
	discordPublicKey    ed25519.PublicKey
	discordBotToken     string
	pixelEventsTopic    string
	snapshotEventsTopic string
	sessionEventsTopic  string
	adminRoleIDs        []string
	pubsubClient        *pubsub.Client
	pubsubOnce          sync.Once
	tracer              trace.Tracer
	tracerProvider      *sdktrace.TracerProvider
)

const discordAPIEndpoint = "https://discord.com/api/v10"

func init() {
	projectID = os.Getenv("PROJECT_ID")
	discordBotToken = strings.TrimSpace(os.Getenv("DISCORD_BOT_TOKEN"))
	pixelEventsTopic = envOrDefault("PIXEL_EVENTS_TOPIC", "pixel-events")
	snapshotEventsTopic = envOrDefault("SNAPSHOT_EVENTS_TOPIC", "snapshot-events")
	sessionEventsTopic = envOrDefault("SESSION_EVENTS_TOPIC", "session-events")

	if roleIDs := os.Getenv("ADMIN_ROLE_IDS"); roleIDs != "" {
		adminRoleIDs = strings.Split(roleIDs, ",")
	}

	if keyHex := strings.TrimSpace(os.Getenv("DISCORD_PUBLIC_KEY")); keyHex != "" {
		keyBytes, err := hex.DecodeString(keyHex)
		if err == nil {
			discordPublicKey = ed25519.PublicKey(keyBytes)
		}
	}

	// Initialize OpenTelemetry with OTLP exporter
	ctx := context.Background()
	exporter, err := otlptracegrpc.New(ctx)
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
	tracer = otel.Tracer("discord-proxy")

	functions.HTTP("handler", Handler)
}

func getPubsubClient() *pubsub.Client {
	pubsubOnce.Do(func() {
		pubsubClient, _ = pubsub.NewClient(context.Background(), projectID)
	})
	return pubsubClient
}

func envOrDefault(key, defaultVal string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return defaultVal
}

// Discord types
type Interaction struct {
	Type          int             `json:"type"`
	Data          InteractionData `json:"data"`
	Member        Member          `json:"member"`
	Token         string          `json:"token"`
	ApplicationID string          `json:"application_id"`
	ChannelID     string          `json:"channel_id"`
}

type InteractionData struct {
	Name    string   `json:"name"`
	Options []Option `json:"options"`
}

type Option struct {
	Name  string      `json:"name"`
	Value interface{} `json:"value"`
}

type Member struct {
	User  User     `json:"user"`
	Roles []string `json:"roles"`
}

type User struct {
	ID       string `json:"id"`
	Username string `json:"username"`
}

func verifySignature(signature, timestamp, body string) bool {
	if discordPublicKey == nil {
		return false
	}

	sigBytes, err := hex.DecodeString(signature)
	if err != nil {
		return false
	}

	return ed25519.Verify(discordPublicKey, []byte(timestamp+body), sigBytes)
}

func isAdmin(member Member) bool {
	for _, role := range member.Roles {
		for _, adminRole := range adminRoleIDs {
			if role == adminRole {
				return true
			}
		}
	}
	return false
}

func sendFollowUp(applicationID, token, content string) error {
	url := fmt.Sprintf("%s/webhooks/%s/%s", discordAPIEndpoint, applicationID, token)
	payload, _ := json.Marshal(map[string]string{"content": content})

	req, err := http.NewRequest("POST", url, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bot "+discordBotToken)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("discord API request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("discord API error: %d", resp.StatusCode)
	}
	return nil
}

func publishMessage(ctx context.Context, topicName string, data interface{}, attrs map[string]string) error {
	payload, err := json.Marshal(data)
	if err != nil {
		return err
	}

	// Propagate trace context via attributes
	if span := trace.SpanFromContext(ctx); span.SpanContext().IsValid() {
		attrs["traceId"] = span.SpanContext().TraceID().String()
		attrs["spanId"] = span.SpanContext().SpanID().String()
	}

	topic := getPubsubClient().Topic(topicName)
	result := topic.Publish(ctx, &pubsub.Message{
		Data:       payload,
		Attributes: attrs,
	})

	_, err = result.Get(ctx)
	return err
}

func routeCanvasCommand(ctx context.Context, interaction Interaction) error {
	var span trace.Span
	ctx, span = tracer.Start(ctx, "routeCanvasCommand")
	defer span.End()

	messageData := map[string]interface{}{
		"action":           "status",
		"userId":           interaction.Member.User.ID,
		"username":         interaction.Member.User.Username,
		"interactionToken": interaction.Token,
		"applicationId":    interaction.ApplicationID,
		"timestamp":        time.Now().UTC().Format(time.RFC3339),
	}

	return publishMessage(ctx, sessionEventsTopic, messageData, map[string]string{
		"type": "session_command",
	})
}

func routeDrawCommand(ctx context.Context, interaction Interaction) error {
	var span trace.Span
	ctx, span = tracer.Start(ctx, "routeDrawCommand")
	defer span.End()

	options := make(map[string]interface{})
	for _, opt := range interaction.Data.Options {
		options[opt.Name] = opt.Value
	}

	x, _ := toInt(options["x"])
	y, _ := toInt(options["y"])
	color := strings.TrimPrefix(fmt.Sprintf("%v", options["color"]), "#")
	color = strings.ToUpper(color)

	if span := trace.SpanFromContext(ctx); span.SpanContext().IsValid() {
		span.SetAttributes(
			attribute.Int("pixel.x", x),
			attribute.Int("pixel.y", y),
			attribute.String("pixel.color", color),
		)
	}

	messageData := map[string]interface{}{
		"x":                x,
		"y":                y,
		"color":            color,
		"userId":           interaction.Member.User.ID,
		"username":         interaction.Member.User.Username,
		"source":           "discord",
		"interactionToken": interaction.Token,
		"applicationId":    interaction.ApplicationID,
		"timestamp":        time.Now().UTC().Format(time.RFC3339),
	}

	return publishMessage(ctx, pixelEventsTopic, messageData, map[string]string{
		"type":   "pixel_placement",
		"source": "discord",
	})
}

func routeSnapshotCommand(ctx context.Context, interaction Interaction) error {
	var span trace.Span
	ctx, span = tracer.Start(ctx, "routeSnapshotCommand")
	defer span.End()

	if !isAdmin(interaction.Member) {
		return sendFollowUp(interaction.ApplicationID, interaction.Token, "You do not have permission to create snapshots.")
	}

	messageData := map[string]interface{}{
		"channelId":        interaction.ChannelID,
		"userId":           interaction.Member.User.ID,
		"username":         interaction.Member.User.Username,
		"interactionToken": interaction.Token,
		"applicationId":    interaction.ApplicationID,
		"timestamp":        time.Now().UTC().Format(time.RFC3339),
	}

	return publishMessage(ctx, snapshotEventsTopic, messageData, map[string]string{
		"type": "snapshot_request",
	})
}

func routeSessionCommand(ctx context.Context, interaction Interaction) error {
	var span trace.Span
	ctx, span = tracer.Start(ctx, "routeSessionCommand")
	defer span.End()

	if !isAdmin(interaction.Member) {
		return sendFollowUp(interaction.ApplicationID, interaction.Token, "You do not have permission to manage sessions.")
	}

	// Get the action value from the "action" option (STRING type with choices)
	action := fmt.Sprintf("%v", interaction.Data.Options[0].Value)

	if span := trace.SpanFromContext(ctx); span.SpanContext().IsValid() {
		span.SetAttributes(attribute.String("session.action", action))
	}

	messageData := map[string]interface{}{
		"action":           action,
		"userId":           interaction.Member.User.ID,
		"username":         interaction.Member.User.Username,
		"interactionToken": interaction.Token,
		"applicationId":    interaction.ApplicationID,
		"timestamp":        time.Now().UTC().Format(time.RFC3339),
	}

	// Extract optional width and height parameters (for "start" action)
	if action == "start" && len(interaction.Data.Options) > 1 {
		for _, option := range interaction.Data.Options[1:] {
			if option.Name == "width" {
				if width, err := toInt(option.Value); err == nil && width >= 10 && width <= 100000 {
					messageData["canvasWidth"] = width
				}
			} else if option.Name == "height" {
				if height, err := toInt(option.Value); err == nil && height >= 10 && height <= 100000 {
					messageData["canvasHeight"] = height
				}
			}
		}
	}

	return publishMessage(ctx, sessionEventsTopic, messageData, map[string]string{
		"type": "session_command",
	})
}

func toInt(v interface{}) (int, error) {
	switch val := v.(type) {
	case float64:
		return int(val), nil
	case string:
		return strconv.Atoi(val)
	default:
		return 0, fmt.Errorf("cannot convert %T to int", v)
	}
}

// sendACK writes the deferred response (type 5) and flushes immediately
func sendACK(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]int{"type": 5})
	if f, ok := w.(http.Flusher); ok {
		f.Flush()
	}
}

func Handler(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	// Start parent span for the request
	var span trace.Span
	ctx, span = tracer.Start(ctx, "discord-webhook")
	defer span.End()

	if r.Method != http.MethodPost {
		http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
		return
	}

	bodyBytes, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "Bad Request", http.StatusBadRequest)
		return
	}
	rawBody := string(bodyBytes)

	signature := r.Header.Get("X-Signature-Ed25519")
	timestamp := r.Header.Get("X-Signature-Timestamp")

	if signature == "" || timestamp == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	if !verifySignature(signature, timestamp, rawBody) {
		http.Error(w, "Invalid signature", http.StatusUnauthorized)
		return
	}

	var interaction Interaction
	if err := json.Unmarshal(bodyBytes, &interaction); err != nil {
		http.Error(w, "Bad Request", http.StatusBadRequest)
		return
	}

	// Handle Discord ping
	if interaction.Type == 1 {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]int{"type": 1})
		return
	}

	// Only handle application commands (type 2)
	if interaction.Type != 2 {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]int{"type": 1})
		return
	}

	commandName := interaction.Data.Name

	// Add command attributes to span
	if span := trace.SpanFromContext(ctx); span.SpanContext().IsValid() {
		span.SetAttributes(
			attribute.String("discord.command", commandName),
			attribute.String("discord.user_id", interaction.Member.User.ID),
			attribute.String("discord.username", interaction.Member.User.Username),
		)
	}

	// All commands: ACK with type 5, then publish to Pub/Sub
	// Workers will send the follow-up message to Discord
	sendACK(w)

	switch commandName {
	case "draw":
		if err := routeDrawCommand(ctx, interaction); err != nil {
			if span := trace.SpanFromContext(ctx); span.SpanContext().IsValid() {
				span.RecordError(err)
				span.SetStatus(codes.Error, err.Error())
			}
		}

	case "canvas":
		if err := routeCanvasCommand(ctx, interaction); err != nil {
			if span := trace.SpanFromContext(ctx); span.SpanContext().IsValid() {
				span.RecordError(err)
				span.SetStatus(codes.Error, err.Error())
			}
		}

	case "snapshot":
		if err := routeSnapshotCommand(ctx, interaction); err != nil {
			if span := trace.SpanFromContext(ctx); span.SpanContext().IsValid() {
				span.RecordError(err)
				span.SetStatus(codes.Error, err.Error())
			}
		}

	case "session":
		if err := routeSessionCommand(ctx, interaction); err != nil {
			if span := trace.SpanFromContext(ctx); span.SpanContext().IsValid() {
				span.RecordError(err)
				span.SetStatus(codes.Error, err.Error())
			}
		}
	}

	// Flush traces before function exits (required for serverless)
	if tracerProvider != nil {
		tracerProvider.ForceFlush(ctx)
	}
}
