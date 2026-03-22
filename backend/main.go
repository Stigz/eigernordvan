package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"sort"
	"strconv"
	"time"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
	"github.com/google/uuid"
)

type tripRequest struct {
	UserName string  `json:"user_name"`
	StartKM  float64 `json:"start_km"`
	EndKM    float64 `json:"end_km"`
}

type tripResponse struct {
	ID           string  `json:"id"`
	DeltaKM      float64 `json:"delta_km"`
	TripCostCHF  float64 `json:"trip_cost_chf"`
	EventType    string  `json:"event_type"`
	LoggedAtUTC  string  `json:"timestamp"`
	Confirmation string  `json:"confirmation"`
}

type tripRecord struct {
	ID          string  `json:"id"`
	Timestamp   string  `json:"timestamp"`
	UserName    string  `json:"user_name"`
	StartKM     float64 `json:"start_km"`
	EndKM       float64 `json:"end_km"`
	DeltaKM     float64 `json:"delta_km"`
	TripCostCHF float64 `json:"trip_cost_chf"`
	EventType   string  `json:"event_type"`
}

type handler struct {
	tableName  string
	corsOrigin string
	db         *dynamodb.Client
}

func main() {
	ctx := context.Background()
	cfg, err := config.LoadDefaultConfig(ctx)
	if err != nil {
		panic(fmt.Errorf("load aws config: %w", err))
	}

	tableName := os.Getenv("TABLE_NAME")
	if tableName == "" {
		panic("TABLE_NAME is required")
	}

	corsOrigin := os.Getenv("CORS_ALLOW_ORIGIN")
	if corsOrigin == "" {
		corsOrigin = "*"
	}

	h := &handler{
		tableName:  tableName,
		corsOrigin: corsOrigin,
		db:         dynamodb.NewFromConfig(cfg),
	}

	lambda.Start(h.handle)
}

func (h *handler) handle(ctx context.Context, request events.APIGatewayV2HTTPRequest) (events.APIGatewayV2HTTPResponse, error) {
	method := request.RequestContext.HTTP.Method

	if method == http.MethodOptions {
		return h.respond(http.StatusNoContent, nil), nil
	}

	switch method {
	case http.MethodPost:
		return h.handleCreateTrip(ctx, request)
	case http.MethodGet:
		return h.handleListTrips(ctx)
	default:
		return h.respondError(http.StatusMethodNotAllowed, "method not allowed"), nil
	}
}

func (h *handler) handleCreateTrip(ctx context.Context, request events.APIGatewayV2HTTPRequest) (events.APIGatewayV2HTTPResponse, error) {
	var payload tripRequest
	if err := json.Unmarshal([]byte(request.Body), &payload); err != nil {
		return h.respondError(http.StatusBadRequest, "invalid json payload"), nil
	}

	if err := validateTrip(payload); err != nil {
		return h.respondError(http.StatusBadRequest, err.Error()), nil
	}

	deltaKM := payload.EndKM - payload.StartKM
	tripCost := deltaKM * 0.50

	now := time.Now().UTC()
	itemID := uuid.NewString()

	item := map[string]types.AttributeValue{
		"id":             &types.AttributeValueMemberS{Value: itemID},
		"timestamp":      &types.AttributeValueMemberS{Value: now.Format(time.RFC3339)},
		"user_name":      &types.AttributeValueMemberS{Value: payload.UserName},
		"start_km":       &types.AttributeValueMemberN{Value: fmt.Sprintf("%.2f", payload.StartKM)},
		"end_km":         &types.AttributeValueMemberN{Value: fmt.Sprintf("%.2f", payload.EndKM)},
		"delta_km":       &types.AttributeValueMemberN{Value: fmt.Sprintf("%.2f", deltaKM)},
		"trip_cost_chf":  &types.AttributeValueMemberN{Value: fmt.Sprintf("%.2f", tripCost)},
		"event_type":     &types.AttributeValueMemberS{Value: "trip_manual"},
		"ledger_comment": &types.AttributeValueMemberS{Value: "Append-only MVP entry. Corrections are new events."},
	}

	_, err := h.db.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: &h.tableName,
		Item:      item,
	})
	if err != nil {
		log.Printf("put item failed: %v", err)
		return h.respondError(http.StatusInternalServerError, "failed to store trip"), nil
	}

	response := tripResponse{
		ID:           itemID,
		DeltaKM:      deltaKM,
		TripCostCHF:  tripCost,
		EventType:    "trip_manual",
		LoggedAtUTC:  now.Format(time.RFC3339),
		Confirmation: "Trip logged. Thanks for keeping the habit simple.",
	}

	return h.respond(http.StatusOK, response), nil
}

func (h *handler) handleListTrips(ctx context.Context) (events.APIGatewayV2HTTPResponse, error) {
	result, err := h.db.Scan(ctx, &dynamodb.ScanInput{
		TableName: &h.tableName,
	})
	if err != nil {
		log.Printf("scan failed: %v", err)
		return h.respondError(http.StatusInternalServerError, "failed to fetch trips"), nil
	}

	trips := make([]tripRecord, 0, len(result.Items))
	for _, item := range result.Items {
		trip, parseErr := parseTripRecord(item)
		if parseErr != nil {
			log.Printf("skipping malformed item: %v", parseErr)
			continue
		}
		trips = append(trips, trip)
	}

	sort.Slice(trips, func(i, j int) bool {
		return trips[i].Timestamp > trips[j].Timestamp
	})

	return h.respond(http.StatusOK, map[string]any{
		"items": trips,
	}), nil
}

func parseTripRecord(item map[string]types.AttributeValue) (tripRecord, error) {
	getString := func(key string) (string, error) {
		value, ok := item[key].(*types.AttributeValueMemberS)
		if !ok {
			return "", fmt.Errorf("%s missing or not string", key)
		}
		return value.Value, nil
	}

	getNumber := func(key string) (float64, error) {
		value, ok := item[key].(*types.AttributeValueMemberN)
		if !ok {
			return 0, fmt.Errorf("%s missing or not number", key)
		}
		return strconv.ParseFloat(value.Value, 64)
	}

	id, err := getString("id")
	if err != nil {
		return tripRecord{}, err
	}
	timestamp, err := getString("timestamp")
	if err != nil {
		return tripRecord{}, err
	}
	userName, err := getString("user_name")
	if err != nil {
		return tripRecord{}, err
	}
	startKM, err := getNumber("start_km")
	if err != nil {
		return tripRecord{}, err
	}
	endKM, err := getNumber("end_km")
	if err != nil {
		return tripRecord{}, err
	}
	deltaKM, err := getNumber("delta_km")
	if err != nil {
		return tripRecord{}, err
	}
	tripCost, err := getNumber("trip_cost_chf")
	if err != nil {
		return tripRecord{}, err
	}
	eventType, err := getString("event_type")
	if err != nil {
		return tripRecord{}, err
	}

	return tripRecord{
		ID:          id,
		Timestamp:   timestamp,
		UserName:    userName,
		StartKM:     startKM,
		EndKM:       endKM,
		DeltaKM:     deltaKM,
		TripCostCHF: tripCost,
		EventType:   eventType,
	}, nil
}

func validateTrip(payload tripRequest) error {
	if payload.UserName == "" {
		return errors.New("user_name is required")
	}
	if payload.EndKM <= payload.StartKM {
		return errors.New("end_km must be greater than start_km")
	}
	return nil
}

func (h *handler) respondError(status int, message string) events.APIGatewayV2HTTPResponse {
	return h.respond(status, map[string]string{"error": message})
}

func (h *handler) respond(status int, payload any) events.APIGatewayV2HTTPResponse {
	body, _ := json.Marshal(payload)
	return events.APIGatewayV2HTTPResponse{
		StatusCode: status,
		Headers: map[string]string{
			"Content-Type":                 "application/json",
			"Access-Control-Allow-Origin":  h.corsOrigin,
			"Access-Control-Allow-Headers": "Content-Type",
			"Access-Control-Allow-Methods": "GET,POST,OPTIONS",
		},
		Body: string(body),
	}
}
