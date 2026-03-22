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

type fuelRequest struct {
	UserName    string  `json:"user_name"`
	OdometerKM  float64 `json:"odometer_km"`
	Liters      float64 `json:"liters"`
	FuelCostCHF float64 `json:"fuel_cost_chf"`
}

type fuelRecord struct {
	ID          string  `json:"id"`
	Timestamp   string  `json:"timestamp"`
	UserName    string  `json:"user_name"`
	OdometerKM  float64 `json:"odometer_km"`
	Liters      float64 `json:"liters"`
	FuelCostCHF float64 `json:"fuel_cost_chf"`
	EventType   string  `json:"event_type"`
}

type eventRecord struct {
	ID          string   `json:"id"`
	Timestamp   string   `json:"timestamp"`
	UserName    string   `json:"user_name"`
	EventType   string   `json:"event_type"`
	StartKM     *float64 `json:"start_km,omitempty"`
	EndKM       *float64 `json:"end_km,omitempty"`
	DeltaKM     *float64 `json:"delta_km,omitempty"`
	TripCostCHF *float64 `json:"trip_cost_chf,omitempty"`
	OdometerKM  *float64 `json:"odometer_km,omitempty"`
	Liters      *float64 `json:"liters,omitempty"`
	FuelCostCHF *float64 `json:"fuel_cost_chf,omitempty"`
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
		if path == "/fuel" {
			return h.handleCreateFuel(ctx, request)
		}
	case http.MethodGet:
		if path == "/trips" {
			return h.handleListTrips(ctx)
		}
		if path == "/fuel" {
			return h.handleListFuel(ctx)
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
	events, err := h.listEvents(ctx)
	if err != nil {
		return nil, err
	}

	trips := make([]tripRecord, 0, len(events))
	for _, event := range events {
		trip, ok := event.asTrip()
		if !ok {
			continue
		}
		trips = append(trips, trip)
	}

	return trips, nil
}

func (h *handler) listFuel(ctx context.Context) ([]fuelRecord, error) {
	events, err := h.listEvents(ctx)
	if err != nil {
		return nil, err
	}

	fuel := make([]fuelRecord, 0, len(events))
	for _, event := range events {
		record, ok := event.asFuel()
		if !ok {
			continue
		}
		fuel = append(fuel, record)
	}

	return fuel, nil
}

func (h *handler) listEvents(ctx context.Context) ([]eventRecord, error) {
	result, err := h.db.Scan(ctx, &dynamodb.ScanInput{
		TableName: &h.tableName,
	})
	if err != nil {
		return nil, err
	}

	records := make([]eventRecord, 0, len(result.Items))
	for _, item := range result.Items {
		record, parseErr := parseEventRecord(item)
		if parseErr != nil {
			log.Printf("skipping malformed item: %v", parseErr)
			continue
		}
		records = append(records, record)
	}

	return records, nil
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

func (h *handler) handleCreateFuel(ctx context.Context, request events.APIGatewayV2HTTPRequest) (events.APIGatewayV2HTTPResponse, error) {
	var payload fuelRequest
	if err := json.Unmarshal([]byte(request.Body), &payload); err != nil {
		return h.respondError(http.StatusBadRequest, "invalid json payload"), nil
	}

	if err := validateFuel(payload); err != nil {
		return h.respondError(http.StatusBadRequest, err.Error()), nil
	}

	now := time.Now().UTC()
	itemID := uuid.NewString()
	item := map[string]types.AttributeValue{
		"id":             &types.AttributeValueMemberS{Value: itemID},
		"timestamp":      &types.AttributeValueMemberS{Value: now.Format(time.RFC3339)},
		"user_name":      &types.AttributeValueMemberS{Value: payload.UserName},
		"odometer_km":    &types.AttributeValueMemberN{Value: fmt.Sprintf("%.2f", payload.OdometerKM)},
		"liters":         &types.AttributeValueMemberN{Value: fmt.Sprintf("%.2f", payload.Liters)},
		"fuel_cost_chf":  &types.AttributeValueMemberN{Value: fmt.Sprintf("%.2f", payload.FuelCostCHF)},
		"event_type":     &types.AttributeValueMemberS{Value: "fuel_manual"},
		"ledger_comment": &types.AttributeValueMemberS{Value: "Append-only MVP entry. Corrections are new events."},
	}

	_, err := h.db.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: &h.tableName,
		Item:      item,
	})
	if err != nil {
		log.Printf("put fuel item failed: %v", err)
		return h.respondError(http.StatusInternalServerError, "failed to store fuel event"), nil
	}

	return h.respond(http.StatusOK, map[string]any{
		"id":            itemID,
		"timestamp":     now.Format(time.RFC3339),
		"event_type":    "fuel_manual",
		"fuel_cost_chf": payload.FuelCostCHF,
		"confirmation":  "Fuel event logged.",
	}), nil
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

func (h *handler) handleListFuel(ctx context.Context) (events.APIGatewayV2HTTPResponse, error) {
	records, err := h.listFuel(ctx)
	if err != nil {
		log.Printf("scan failed: %v", err)
		return h.respondError(http.StatusInternalServerError, "failed to fetch fuel events"), nil
	}

	sort.Slice(records, func(i, j int) bool {
		if records[i].OdometerKM == records[j].OdometerKM {
			return records[i].Timestamp > records[j].Timestamp
		}
		return records[i].OdometerKM > records[j].OdometerKM
	})

	return h.respond(http.StatusOK, map[string]any{
		"items": records,
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
	if err := validateTripUpdate(payload, trips, id); err != nil {
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
	record, err := parseEventRecord(item)
	if err != nil {
		return tripRecord{}, err
	}
	trip, ok := record.asTrip()
	if !ok {
		return tripRecord{}, errors.New("record is not a trip event")
	}
	return trip, nil
}

func parseEventRecord(item map[string]types.AttributeValue) (eventRecord, error) {
	getStringRequired := func(key string) (string, error) {
		value, ok := item[key].(*types.AttributeValueMemberS)
		if !ok {
			return "", fmt.Errorf("%s missing or not string", key)
		}
		return value.Value, nil
	}

	getNumberOptional := func(key string) (*float64, error) {
		value, ok := item[key]
		if !ok {
			return nil, nil
		}
		number, ok := value.(*types.AttributeValueMemberN)
		if !ok {
			return nil, fmt.Errorf("%s present but not number", key)
		}
		parsed, err := strconv.ParseFloat(number.Value, 64)
		if err != nil {
			return nil, fmt.Errorf("parse %s: %w", key, err)
		}
		return &parsed, nil
	}

	id, err := getStringRequired("id")
	if err != nil {
		return eventRecord{}, err
	}
	timestamp, err := getStringRequired("timestamp")
	if err != nil {
		return eventRecord{}, err
	}
	userName, err := getStringRequired("user_name")
	if err != nil {
		return eventRecord{}, err
	}
	eventType, err := getStringRequired("event_type")
	if err != nil {
		return eventRecord{}, err
	}

	startKM, err := getNumberOptional("start_km")
	if err != nil {
		return eventRecord{}, err
	}
	endKM, err := getNumberOptional("end_km")
	if err != nil {
		return eventRecord{}, err
	}
	deltaKM, err := getNumberOptional("delta_km")
	if err != nil {
		return eventRecord{}, err
	}
	tripCost, err := getNumberOptional("trip_cost_chf")
	if err != nil {
		return eventRecord{}, err
	}
	odometerKM, err := getNumberOptional("odometer_km")
	if err != nil {
		return eventRecord{}, err
	}
	liters, err := getNumberOptional("liters")
	if err != nil {
		return eventRecord{}, err
	}
	fuelCost, err := getNumberOptional("fuel_cost_chf")
	if err != nil {
		return eventRecord{}, err
	}

	return eventRecord{
		ID:          id,
		Timestamp:   timestamp,
		UserName:    userName,
		StartKM:     startKM,
		EndKM:       endKM,
		DeltaKM:     deltaKM,
		TripCostCHF: tripCost,
		OdometerKM:  odometerKM,
		Liters:      liters,
		FuelCostCHF: fuelCost,
		EventType:   eventType,
	}, nil
}

func (r eventRecord) asTrip() (tripRecord, bool) {
	if r.StartKM == nil || r.EndKM == nil || r.DeltaKM == nil || r.TripCostCHF == nil {
		return tripRecord{}, false
	}

	return tripRecord{
		ID:          r.ID,
		Timestamp:   r.Timestamp,
		UserName:    r.UserName,
		StartKM:     *r.StartKM,
		EndKM:       *r.EndKM,
		DeltaKM:     *r.DeltaKM,
		TripCostCHF: *r.TripCostCHF,
		EventType:   r.EventType,
	}, true
}

func (r eventRecord) asFuel() (fuelRecord, bool) {
	if r.OdometerKM == nil || r.Liters == nil || r.FuelCostCHF == nil {
		return fuelRecord{}, false
	}

	return fuelRecord{
		ID:          r.ID,
		Timestamp:   r.Timestamp,
		UserName:    r.UserName,
		OdometerKM:  *r.OdometerKM,
		Liters:      *r.Liters,
		FuelCostCHF: *r.FuelCostCHF,
		EventType:   r.EventType,
	}, true
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

func validateFuel(payload fuelRequest) error {
	if payload.UserName == "" {
		return errors.New("user_name is required")
	}
	if payload.OdometerKM <= 0 {
		return errors.New("odometer_km must be greater than 0")
	}
	if payload.Liters <= 0 {
		return errors.New("liters must be greater than 0")
	}
	if payload.FuelCostCHF <= 0 {
		return errors.New("fuel_cost_chf must be greater than 0")
	}
	return nil
}

func validateTripWithHistory(payload tripRequest, trips []tripRecord, currentID string) error {
	if len(trips) == 0 {
		return nil
	}

	latestEnd := trips[0].EndKM
	for _, trip := range trips[1:] {
		if trip.EndKM > latestEnd {
			latestEnd = trip.EndKM
		}
	}

	if payload.StartKM != latestEnd {
		return fmt.Errorf("start_km must match latest recorded end odometer (%.1f)", latestEnd)
	}

	return nil
}

func validateTripUpdate(payload tripRequest, trips []tripRecord, currentID string) error {
	if currentID == "" {
		return errors.New("trip id is required")
	}

	for _, trip := range trips {
		if trip.ID == currentID {
			continue
		}
		if payload.StartKM < trip.EndKM && payload.EndKM > trip.StartKM {
			return fmt.Errorf("edited range %.1f-%.1f overlaps existing trip %.1f-%.1f", payload.StartKM, payload.EndKM, trip.StartKM, trip.EndKM)
		}
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
