package snapshotworker

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"image/png"
	"log"
	"math"
	"net/http"
	"os"
	"runtime"
	"strings"
	"sync"
	"time"

	"cloud.google.com/go/firestore"
	"cloud.google.com/go/storage"
	"github.com/GoogleCloudPlatform/functions-framework-go/functions"
	"github.com/cloudevents/sdk-go/v2/event"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracegrpc"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/trace"
)

const (
	tileSize         = 2048
	thumbnailMaxSize = 800
	discordAPI       = "https://discord.com/api/v10"
)

var (
	projectID       string
	snapshotsBucket string
	discordBotToken string
	fsClient        *firestore.Client
	stClient        *storage.Client
	fsOnce          sync.Once
	stOnce          sync.Once
	tracer          trace.Tracer
	tracerProvider  *sdktrace.TracerProvider
)

func init() {
	projectID = os.Getenv("PROJECT_ID")
	snapshotsBucket = os.Getenv("SNAPSHOTS_BUCKET")
	discordBotToken = strings.TrimSpace(os.Getenv("DISCORD_BOT_TOKEN"))

	// Initialize OpenTelemetry with OTLP exporter
	ctx := context.Background()
	exporter, err := otlptracegrpc.New(ctx)
	if err == nil {
		// Use WithFromEnv to pick up OTEL_SERVICE_NAME from environment
		res, _ := resource.New(ctx,
			resource.WithFromEnv(),
			resource.WithTelemetrySDK(),
		)
		tracerProvider = sdktrace.NewTracerProvider(
			sdktrace.WithBatcher(exporter),
			sdktrace.WithResource(res),
		)
		otel.SetTracerProvider(tracerProvider)
		tracer = tracerProvider.Tracer("snapshot-worker")
	}

	functions.CloudEvent("handler", handleCloudEvent)
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

func getStorage() *storage.Client {
	stOnce.Do(func() {
		var err error
		stClient, err = storage.NewClient(context.Background())
		if err != nil {
			log.Fatalf("Storage client: %v", err)
		}
	})
	return stClient
}

// Pixel from Firestore
type Pixel struct {
	X     int    `firestore:"x"`
	Y     int    `firestore:"y"`
	Color string `firestore:"color"`
}

type tileKey struct{ x, y int }

type TileResult struct {
	X   int    `json:"x"`
	Y   int    `json:"y"`
	URL string `json:"url"`
}

type Manifest struct {
	Timestamp    int64        `json:"timestamp"`
	CanvasWidth  int          `json:"canvasWidth"`
	CanvasHeight int          `json:"canvasHeight"`
	TileSize     int          `json:"tileSize"`
	TilesX       int          `json:"tilesX"`
	TilesY       int          `json:"tilesY"`
	Tiles        []TileResult `json:"tiles"`
	ThumbnailURL string       `json:"thumbnailUrl"`
	PixelCount   int          `json:"pixelCount"`
}

// CloudEvent Pub/Sub data
type MessagePublishedData struct {
	Message struct {
		Data       []byte            `json:"data"`
		Attributes map[string]string `json:"attributes"`
	} `json:"message"`
}

type SnapshotRequest struct {
	ChannelID        string `json:"channelId"`
	UserID           string `json:"userId"`
	Username         string `json:"username"`
	InteractionToken string `json:"interactionToken"`
	ApplicationID    string `json:"applicationId"`
}

func getAllPixels(ctx context.Context) ([]Pixel, error) {
	docs, err := getFirestore().Collection("pixels").Documents(ctx).GetAll()
	if err != nil {
		return nil, err
	}
	pixels := make([]Pixel, 0, len(docs))
	for _, doc := range docs {
		var p Pixel
		if err := doc.DataTo(&p); err != nil {
			continue
		}
		pixels = append(pixels, p)
	}
	return pixels, nil
}

func parseColor(c string) color.RGBA {
	c = strings.TrimPrefix(c, "#")
	if len(c) != 6 {
		return color.RGBA{0, 0, 0, 255}
	}
	var r, g, b uint8
	fmt.Sscanf(c, "%02x%02x%02x", &r, &g, &b)
	return color.RGBA{r, g, b, 255}
}

func generateTile(pixels []Pixel, tx, ty, canvasW, canvasH int) []byte {
	startX := tx * tileSize
	startY := ty * tileSize
	endX := min(startX+tileSize, canvasW)
	endY := min(startY+tileSize, canvasH)
	w := endX - startX
	h := endY - startY

	img := image.NewRGBA(image.Rect(0, 0, w, h))
	draw.Draw(img, img.Bounds(), &image.Uniform{color.White}, image.Point{}, draw.Src)

	for _, p := range pixels {
		img.Set(p.X-startX, p.Y-startY, parseColor(p.Color))
	}

	var buf bytes.Buffer
	enc := &png.Encoder{CompressionLevel: png.BestSpeed}
	enc.Encode(&buf, img)
	return buf.Bytes()
}

func generateThumbnail(pixels []Pixel, canvasW, canvasH int) []byte {
	scale := math.Min(float64(thumbnailMaxSize)/float64(canvasW), float64(thumbnailMaxSize)/float64(canvasH))
	scale = math.Min(scale, 1.0)

	tw := max(1, int(float64(canvasW)*scale))
	th := max(1, int(float64(canvasH)*scale))

	img := image.NewRGBA(image.Rect(0, 0, tw, th))
	draw.Draw(img, img.Bounds(), &image.Uniform{color.White}, image.Point{}, draw.Src)

	for _, p := range pixels {
		if p.X >= 0 && p.X < canvasW && p.Y >= 0 && p.Y < canvasH {
			px := int(float64(p.X) * scale)
			py := int(float64(p.Y) * scale)
			if px < tw && py < th {
				img.Set(px, py, parseColor(p.Color))
			}
		}
	}

	var buf bytes.Buffer
	enc := &png.Encoder{CompressionLevel: png.BestSpeed}
	enc.Encode(&buf, img)
	return buf.Bytes()
}

func upload(ctx context.Context, data []byte, path, contentType string) (string, error) {
	obj := getStorage().Bucket(snapshotsBucket).Object(path)
	w := obj.NewWriter(ctx)
	w.ContentType = contentType
	w.CacheControl = "public, max-age=3600"
	if _, err := w.Write(data); err != nil {
		w.Close()
		return "", err
	}
	if err := w.Close(); err != nil {
		return "", err
	}
	return fmt.Sprintf("https://storage.googleapis.com/%s/%s", snapshotsBucket, path), nil
}

func toIntVal(v interface{}) int {
	switch val := v.(type) {
	case int64:
		return int(val)
	case float64:
		return int(val)
	default:
		return 0
	}
}

func postToDiscord(channelID, thumbnailURL string, m Manifest) {
	body, _ := json.Marshal(map[string]interface{}{
		"embeds": []map[string]interface{}{{
			"title": "Canvas Snapshot",
			"description": fmt.Sprintf("**Canvas:** %dx%d pixels\n**Pixels drawn:** %d\n**Tiles:** %d (sparse)\n\n[View Thumbnail](%s)",
				m.CanvasWidth, m.CanvasHeight, m.PixelCount, len(m.Tiles), thumbnailURL),
			"image":     map[string]string{"url": thumbnailURL},
			"color":     0x5865F2,
			"timestamp": time.Now().UTC().Format(time.RFC3339),
			"footer":    map[string]string{"text": fmt.Sprintf("Tile size: %dpx | Sparse chunking", tileSize)},
		}},
	})

	req, _ := http.NewRequest("POST", fmt.Sprintf("%s/channels/%s/messages", discordAPI, channelID), bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bot "+discordBotToken)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return
	}
	resp.Body.Close()
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

func handleCloudEvent(ctx context.Context, e event.Event) error {
	start := time.Now()

	var msg MessagePublishedData
	if err := e.DataAs(&msg); err != nil {
		return fmt.Errorf("parse event: %w", err)
	}

	// Extract trace context from Pub/Sub attributes and create linked span
	if tracer != nil {
		var span trace.Span
		if traceID := msg.Message.Attributes["traceId"]; traceID != "" {
			if spanID := msg.Message.Attributes["spanId"]; spanID != "" {
				// Parse trace and span IDs
				tid, _ := trace.TraceIDFromHex(traceID)
				sid, _ := trace.SpanIDFromHex(spanID)
				
				// Create remote span context as parent
				parentCtx := trace.NewSpanContext(trace.SpanContextConfig{
					TraceID:    tid,
					SpanID:     sid,
					TraceFlags: trace.FlagsSampled,
					Remote:     true,
				})
				ctx = trace.ContextWithRemoteSpanContext(ctx, parentCtx)
			}
		}
		ctx, span = tracer.Start(ctx, "generateSnapshot")
		defer span.End()
	}

	var req SnapshotRequest
	if err := json.Unmarshal(msg.Message.Data, &req); err != nil {
		return fmt.Errorf("parse request: %w", err)
	}

	// Get canvas dimensions from session
	canvasW, canvasH := 1000, 1000
	if doc, err := getFirestore().Collection("sessions").Doc("current").Get(ctx); err == nil {
		data := doc.Data()
		if w := toIntVal(data["canvasWidth"]); w > 0 {
			canvasW = w
		}
		if h := toIntVal(data["canvasHeight"]); h > 0 {
			canvasH = h
		}
	}

	// Add span attributes
	if span := trace.SpanFromContext(ctx); span.SpanContext().IsValid() {
		span.SetAttributes(
			attribute.Int("canvas.width", canvasW),
			attribute.Int("canvas.height", canvasH),
			attribute.String("snapshot.user_id", req.UserID),
		)
	}

	// Get all pixels
	pixels, err := getAllPixels(ctx)
	if err != nil {
		sendFollowUp(req.ApplicationID, req.InteractionToken, fmt.Sprintf("Failed to get pixels: %v", err))
		return err
	}

	timestamp := time.Now().UnixMilli()
	snapshotDir := fmt.Sprintf("snapshots/%d", timestamp)
	tilesX := int(math.Ceil(float64(canvasW) / float64(tileSize)))
	tilesY := int(math.Ceil(float64(canvasH) / float64(tileSize)))

	// Group pixels by tile — only tiles with pixels will be generated
	tilePixelMap := make(map[tileKey][]Pixel)
	for _, p := range pixels {
		if p.X >= 0 && p.X < canvasW && p.Y >= 0 && p.Y < canvasH {
			tk := tileKey{p.X / tileSize, p.Y / tileSize}
			tilePixelMap[tk] = append(tilePixelMap[tk], p)
		}
	}

	// Generate + upload tiles in parallel using goroutine pool
	maxWorkers := runtime.NumCPU() * 2
	if maxWorkers > 32 {
		maxWorkers = 32
	}
	if maxWorkers < 4 {
		maxWorkers = 4
	}

	sem := make(chan struct{}, maxWorkers)
	var wg sync.WaitGroup
	var mu sync.Mutex
	var results []TileResult

	for tk, px := range tilePixelMap {
		wg.Add(1)
		go func(tk tileKey, px []Pixel) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()

			data := generateTile(px, tk.x, tk.y, canvasW, canvasH)
			path := fmt.Sprintf("%s/tile-%d-%d.png", snapshotDir, tk.x, tk.y)
			url, err := upload(ctx, data, path, "image/png")
			if err != nil {
				return
			}

			mu.Lock()
			results = append(results, TileResult{X: tk.x, Y: tk.y, URL: url})
			mu.Unlock()
		}(tk, px)
	}

	var thumbURL string
	wg.Add(1)
	go func() {
		defer wg.Done()
		sem <- struct{}{}
		defer func() { <-sem }()

		thumbData := generateThumbnail(pixels, canvasW, canvasH)
		thumbURL, _ = upload(ctx, thumbData, snapshotDir+"/thumbnail.png", "image/png")
	}()

	wg.Wait()

	// Create manifest
	manifest := Manifest{
		Timestamp:    timestamp,
		CanvasWidth:  canvasW,
		CanvasHeight: canvasH,
		TileSize:     tileSize,
		TilesX:       tilesX,
		TilesY:       tilesY,
		Tiles:        results,
		ThumbnailURL: thumbURL,
		PixelCount:   len(pixels),
	}

	manifestJSON, _ := json.MarshalIndent(manifest, "", "  ")
	manifestURL, err := upload(ctx, manifestJSON, snapshotDir+"/manifest.json", "application/json")

	elapsed := time.Since(start)

	// Add final span attributes
	if span := trace.SpanFromContext(ctx); span.SpanContext().IsValid() {
		span.SetAttributes(
			attribute.Int("snapshot.pixel_count", len(pixels)),
			attribute.Int("snapshot.tile_count", len(results)),
			attribute.Float64("snapshot.duration_seconds", elapsed.Seconds()),
		)
	}

	// Post to Discord
	if req.ChannelID != "" {
		postToDiscord(req.ChannelID, thumbURL, manifest)
	}

	// Send follow-up
	if req.InteractionToken != "" && req.ApplicationID != "" {
		msg := fmt.Sprintf("Snapshot generated in %.1fs: %d tiles (%d pixels)\nManifest: %s",
			elapsed.Seconds(), len(results), len(pixels), manifestURL)
		sendFollowUp(req.ApplicationID, req.InteractionToken, msg)
	}

	// Flush traces before function exits (required for serverless)
	if tracerProvider != nil {
		tracerProvider.ForceFlush(ctx)
	}

	return nil
}
