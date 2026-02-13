package discordproxy

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"cloud.google.com/go/pubsub"
	"github.com/GoogleCloudPlatform/functions-framework-go/functions"
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
		if err != nil {
			log.Printf("Failed to decode DISCORD_PUBLIC_KEY: %v", err)
		} else {
			discordPublicKey = ed25519.PublicKey(keyBytes)
		}
	}

	functions.HTTP("handler", Handler)
}

func getPubsubClient() *pubsub.Client {
	pubsubOnce.Do(func() {
		var err error
		pubsubClient, err = pubsub.NewClient(context.Background(), projectID)
		if err != nil {
			log.Printf("Failed to create Pub/Sub client: %v", err)
		}
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
		log.Println("DISCORD_PUBLIC_KEY not configured")
		return false
	}

	sigBytes, err := hex.DecodeString(signature)
	if err != nil {
		log.Printf("Failed to decode signature: %v", err)
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

	log.Printf("Publishing to %s: %s", topicName, string(payload))

	topic := getPubsubClient().Topic(topicName)
	result := topic.Publish(ctx, &pubsub.Message{
		Data:       payload,
		Attributes: attrs,
	})

	_, err = result.Get(ctx)
	return err
}

func routeCanvasCommand(ctx context.Context, interaction Interaction) error {
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
	options := make(map[string]interface{})
	for _, opt := range interaction.Data.Options {
		options[opt.Name] = opt.Value
	}

	x, _ := toInt(options["x"])
	y, _ := toInt(options["y"])
	color := strings.TrimPrefix(fmt.Sprintf("%v", options["color"]), "#")
	color = strings.ToUpper(color)

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
	if !isAdmin(interaction.Member) {
		return sendFollowUp(interaction.ApplicationID, interaction.Token, "You do not have permission to manage sessions.")
	}

	// Get the action value from the "action" option (STRING type with choices)
	action := fmt.Sprintf("%v", interaction.Data.Options[0].Value)

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
		log.Printf("Session start - found %d options", len(interaction.Data.Options))
		for _, option := range interaction.Data.Options[1:] {
			log.Printf("Option: %s = %v", option.Name, option.Value)
			if option.Name == "width" {
				if width, err := toInt(option.Value); err == nil && width >= 10 && width <= 100000 {
					messageData["canvasWidth"] = width
					log.Printf("Set canvasWidth to %d", width)
				}
			} else if option.Name == "height" {
				if height, err := toInt(option.Value); err == nil && height >= 10 && height <= 100000 {
					messageData["canvasHeight"] = height
					log.Printf("Set canvasHeight to %d", height)
				}
			}
		}
	} else {
		log.Printf("Session action=%s, options=%d", action, len(interaction.Data.Options))
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
	log.Printf("Discord webhook received: method=%s", r.Method)

	if r.Method != http.MethodPost {
		http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
		return
	}

	bodyBytes, err := io.ReadAll(r.Body)
	if err != nil {
		log.Printf("Failed to read body: %v", err)
		http.Error(w, "Bad Request", http.StatusBadRequest)
		return
	}
	rawBody := string(bodyBytes)

	signature := r.Header.Get("X-Signature-Ed25519")
	timestamp := r.Header.Get("X-Signature-Timestamp")

	if signature == "" || timestamp == "" {
		log.Println("Missing signature headers")
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	if !verifySignature(signature, timestamp, rawBody) {
		log.Println("Invalid signature")
		http.Error(w, "Invalid signature", http.StatusUnauthorized)
		return
	}

	log.Println("Signature verified successfully")

	var interaction Interaction
	if err := json.Unmarshal(bodyBytes, &interaction); err != nil {
		log.Printf("Failed to parse interaction: %v", err)
		http.Error(w, "Bad Request", http.StatusBadRequest)
		return
	}

	// Handle Discord ping
	if interaction.Type == 1 {
		log.Println("Discord ping received, responding with type 1")
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]int{"type": 1})
		return
	}

	// Only handle application commands (type 2)
	if interaction.Type != 2 {
		log.Printf("Ignoring non-command interaction type: %d", interaction.Type)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]int{"type": 1})
		return
	}

	commandName := interaction.Data.Name
	log.Printf("Processing command: /%s", commandName)

	ctx := context.Background()

	// All commands: ACK with type 5, then publish to Pub/Sub
	// Workers will send the follow-up message to Discord
	sendACK(w)

	switch commandName {
	case "draw":
		if err := routeDrawCommand(ctx, interaction); err != nil {
			log.Printf("Failed to route draw command: %v", err)
		}

	case "canvas":
		if err := routeCanvasCommand(ctx, interaction); err != nil {
			log.Printf("Failed to route canvas command: %v", err)
		}

	case "snapshot":
		if err := routeSnapshotCommand(ctx, interaction); err != nil {
			log.Printf("Failed to route snapshot command: %v", err)
		}

	case "session":
		if err := routeSessionCommand(ctx, interaction); err != nil {
			log.Printf("Failed to route session command: %v", err)
		}

	default:
		log.Printf("Unknown command: %s", commandName)
	}
}
