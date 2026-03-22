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
	"strings"
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
	path := request.RawPath

	if method == http.MethodOptions {
		return h.respond(http.StatusNoContent, nil), nil
	}

	switch method {
	case http.MethodPost:
		if path == "/trip" {
			return h.handleCreateTrip(ctx, request)
		}
	case http.MethodGet:
		if path == "/trips" {
			return h.handleListTrips(ctx)
		}
	case http.MethodPut:
		if strings.HasPrefix(path, "/trip/") {
			return h.handleUpdateTrip(ctx, request, strings.TrimPrefix(path, "/trip/"))
		}
	case http.MethodDelete:
		if strings.HasPrefix(path, "/trip/") {
			return h.handleDeleteTrip(ctx, strings.TrimPrefix(path, "/trip/"))
		}
	default:
		return h.respondError(http.StatusMethodNotAllowed, "method not allowed"), nil
	}

	return h.respondError(http.StatusNotFound, "route not found"), nil
}

func (h *handler) listTrips(ctx context.Context) ([]tripRecord, error) {
	result, err := h.db.Scan(ctx, &dynamodb.ScanInput{
		TableName: &h.tableName,
	})
	if err != nil {
		return nil, err
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

	return trips, nil
}

func (h *handler) handleCreateTrip(ctx context.Context, request events.APIGatewayV2HTTPRequest) (events.APIGatewayV2HTTPResponse, error) {
	var payload tripRequest
	if err := json.Unmarshal([]byte(request.Body), &payload); err != nil {
		return h.respondError(http.StatusBadRequest, "invalid json payload"), nil
	}

	if err := validateTrip(payload); err != nil {
		return h.respondError(http.StatusBadRequest, err.Error()), nil
	}

	trips, err := h.listTrips(ctx)
	if err != nil {
		log.Printf("scan failed: %v", err)
		return h.respondError(http.StatusInternalServerError, "failed to validate trip"), nil
	}
	if err := validateTripWithHistory(payload, trips, ""); err != nil {
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

	_, err = h.db.PutItem(ctx, &dynamodb.PutItemInput{
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
	trips, err := h.listTrips(ctx)
	if err != nil {
		log.Printf("scan failed: %v", err)
		return h.respondError(http.StatusInternalServerError, "failed to fetch trips"), nil
	}

	sort.Slice(trips, func(i, j int) bool {
		if trips[i].EndKM == trips[j].EndKM {
			return trips[i].Timestamp > trips[j].Timestamp
		}
		return trips[i].EndKM > trips[j].EndKM
	})

	return h.respond(http.StatusOK, map[string]any{
		"items": trips,
	}), nil
}

func (h *handler) handleUpdateTrip(ctx context.Context, request events.APIGatewayV2HTTPRequest, id string) (events.APIGatewayV2HTTPResponse, error) {
	var payload tripRequest
	if err := json.Unmarshal([]byte(request.Body), &payload); err != nil {
		return h.respondError(http.StatusBadRequest, "invalid json payload"), nil
	}

	if err := validateTrip(payload); err != nil {
		return h.respondError(http.StatusBadRequest, err.Error()), nil
	}

	trips, err := h.listTrips(ctx)
	if err != nil {
		log.Printf("scan failed: %v", err)
		return h.respondError(http.StatusInternalServerError, "failed to validate trip"), nil
	}
	if err := validateTripWithHistory(payload, trips, id); err != nil {
		return h.respondError(http.StatusBadRequest, err.Error()), nil
	}

	now := time.Now().UTC()
	deltaKM := payload.EndKM - payload.StartKM
	tripCost := deltaKM * 0.50

	item := map[string]types.AttributeValue{
		"id":             &types.AttributeValueMemberS{Value: id},
		"timestamp":      &types.AttributeValueMemberS{Value: now.Format(time.RFC3339)},
		"user_name":      &types.AttributeValueMemberS{Value: payload.UserName},
		"start_km":       &types.AttributeValueMemberN{Value: fmt.Sprintf("%.2f", payload.StartKM)},
		"end_km":         &types.AttributeValueMemberN{Value: fmt.Sprintf("%.2f", payload.EndKM)},
		"delta_km":       &types.AttributeValueMemberN{Value: fmt.Sprintf("%.2f", deltaKM)},
		"trip_cost_chf":  &types.AttributeValueMemberN{Value: fmt.Sprintf("%.2f", tripCost)},
		"event_type":     &types.AttributeValueMemberS{Value: "trip_manual_updated"},
		"ledger_comment": &types.AttributeValueMemberS{Value: "Entry updated to resolve odometer mistakes."},
	}

	_, err = h.db.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: &h.tableName,
		Item:      item,
	})
	if err != nil {
		log.Printf("update item failed: %v", err)
		return h.respondError(http.StatusInternalServerError, "failed to update trip"), nil
	}

	return h.respond(http.StatusOK, map[string]any{
		"id":            id,
		"delta_km":      deltaKM,
		"trip_cost_chf": tripCost,
		"timestamp":     now.Format(time.RFC3339),
	}), nil
}

func (h *handler) handleDeleteTrip(ctx context.Context, id string) (events.APIGatewayV2HTTPResponse, error) {
	_, err := h.db.DeleteItem(ctx, &dynamodb.DeleteItemInput{
		TableName: &h.tableName,
		Key: map[string]types.AttributeValue{
			"id": &types.AttributeValueMemberS{Value: id},
		},
	})
	if err != nil {
		log.Printf("delete item failed: %v", err)
		return h.respondError(http.StatusInternalServerError, "failed to delete trip"), nil
	}

	return h.respond(http.StatusOK, map[string]string{"status": "deleted"}), nil
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

func validateTripWithHistory(payload tripRequest, trips []tripRecord, currentID string) error {
	if len(trips) == 0 {
		return nil
	}

	filtered := make([]tripRecord, 0, len(trips))
	for _, trip := range trips {
		if trip.ID == currentID {
			continue
		}
		filtered = append(filtered, trip)
	}

	if len(filtered) == 0 {
		return nil
	}

	sort.Slice(filtered, func(i, j int) bool {
		return filtered[i].EndKM > filtered[j].EndKM
	})

	latestEnd := filtered[0].EndKM
	if payload.StartKM != latestEnd {
		return fmt.Errorf("start_km must match latest recorded end odometer (%.1f)", latestEnd)
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
			"Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
		},
		Body: string(body),
	}
}
