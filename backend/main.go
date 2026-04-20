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
	UserName string   `json:"user_name"`
	StartKM  *float64 `json:"start_km,omitempty"`
	EndKM    *float64 `json:"end_km,omitempty"`
}

type tripResponse struct {
	ID           string  `json:"id"`
	DeltaKM      float64 `json:"delta_km"`
	TripCostCHF  float64 `json:"trip_cost_chf"`
	EventType    string  `json:"event_type"`
	LoggedAtUTC  string  `json:"timestamp"`
	Confirmation string  `json:"confirmation"`
}

type openTripResponse struct {
	ID        string  `json:"id"`
	Timestamp string  `json:"timestamp"`
	UserName  string  `json:"user_name"`
	StartKM   float64 `json:"start_km"`
}

type personContext struct {
	Name              string   `json:"name"`
	LastTripStartKM   *float64 `json:"last_trip_start_km,omitempty"`
	LastTripEndKM     *float64 `json:"last_trip_end_km,omitempty"`
	HasOpenTrip       bool     `json:"has_open_trip"`
	OpenTripStartKM   *float64 `json:"open_trip_start_km,omitempty"`
	LastFuelOdometer  *float64 `json:"last_fuel_odometer_km,omitempty"`
	LastActivityAtUTC string   `json:"last_activity_at_utc,omitempty"`
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

type bookingRequest struct {
	StartDate   string   `json:"start_date"`
	EndDate     string   `json:"end_date"`
	Status      string   `json:"status"`
	GuestName   *string  `json:"guest_name,omitempty"`
	Notes       *string  `json:"notes,omitempty"`
	DayKM       *float64 `json:"day_km,omitempty"`
	NightlyRate *float64 `json:"nightly_rate,omitempty"`
	CleaningFee *float64 `json:"cleaning_fee,omitempty"`
	KMRate      *float64 `json:"km_rate,omitempty"`
}

type bookingRecord struct {
	ID            string  `json:"id"`
	StartDate     string  `json:"start_date"`
	EndDate       string  `json:"end_date"`
	Status        string  `json:"status"`
	GuestName     string  `json:"guest_name,omitempty"`
	Notes         string  `json:"notes,omitempty"`
	DayKM         float64 `json:"day_km"`
	NightlyRate   float64 `json:"nightly_rate"`
	CleaningFee   float64 `json:"cleaning_fee"`
	KMRate        float64 `json:"km_rate"`
	EstimateTotal float64 `json:"estimate_total"`
	Nights        int     `json:"nights"`
	CreatedAt     string  `json:"created_at"`
	UpdatedAt     string  `json:"updated_at"`
}

type workStatePayload struct {
	Tasks []map[string]any `json:"tasks"`
	Todos []map[string]any `json:"todos"`
	Board []map[string]any `json:"board"`
}

type costEntryPayload struct {
	ID             string   `json:"id"`
	Date           string   `json:"date"`
	Type           string   `json:"type"`
	AmountCHF      float64  `json:"amount_chf"`
	Description    string   `json:"description"`
	Category       string   `json:"category"`
	PaidBy         string   `json:"paid_by,omitempty"`
	Participants   []string `json:"participants,omitempty"`
	FromPerson     string   `json:"from_person,omitempty"`
	ToPerson       string   `json:"to_person,omitempty"`
	HistoricalOnly bool     `json:"historical_only"`
	Notes          string   `json:"notes,omitempty"`
	CreatedAt      string   `json:"created_at,omitempty"`
	UpdatedAt      string   `json:"updated_at,omitempty"`
}

type costStatePayload struct {
	Entries []costEntryPayload `json:"entries"`
}

type handler struct {
	tableName        string
	bookingTableName string
	workTableName    string
	corsOrigin       string
	db               *dynamodb.Client
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
	bookingTableName := os.Getenv("BOOKING_TABLE_NAME")
	if bookingTableName == "" {
		panic("BOOKING_TABLE_NAME is required")
	}
	workTableName := os.Getenv("WORK_TABLE_NAME")
	if workTableName == "" {
		panic("WORK_TABLE_NAME is required")
	}

	corsOrigin := os.Getenv("CORS_ALLOW_ORIGIN")
	if corsOrigin == "" {
		corsOrigin = "*"
	}

	h := &handler{
		tableName:        tableName,
		bookingTableName: bookingTableName,
		workTableName:    workTableName,
		corsOrigin:       corsOrigin,
		db:               dynamodb.NewFromConfig(cfg),
	}

	lambda.Start(h.handle)
}

func normalizeRoutePath(request events.APIGatewayV2HTTPRequest) string {
	path := strings.TrimSpace(request.RawPath)
	if path == "" {
		path = strings.TrimSpace(request.RequestContext.HTTP.Path)
	}
	if path == "" {
		return "/"
	}

	if len(path) > 1 {
		path = strings.TrimRight(path, "/")
		if path == "" {
			path = "/"
		}
	}

	stage := strings.Trim(strings.TrimSpace(request.RequestContext.Stage), "/")
	if stage != "" {
		prefix := "/" + stage
		if path == prefix {
			return "/"
		}
		if strings.HasPrefix(path, prefix+"/") {
			path = strings.TrimPrefix(path, prefix)
		}
	}

	return path
}

func (h *handler) handle(ctx context.Context, request events.APIGatewayV2HTTPRequest) (events.APIGatewayV2HTTPResponse, error) {
	method := request.RequestContext.HTTP.Method
	path := normalizeRoutePath(request)

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
		if path == "/bookings" {
			return h.handleCreateBooking(ctx, request)
		}
	case http.MethodGet:
		if path == "/trips" {
			return h.handleListTrips(ctx)
		}
		if path == "/intake/context" {
			return h.handleGetIntakeContext(ctx)
		}
		if path == "/trip/open" {
			return h.handleGetOpenTrip(ctx)
		}
		if path == "/fuel" {
			return h.handleListFuel(ctx)
		}
		if path == "/bookings" {
			return h.handleListBookings(ctx, request)
		}
		if path == "/work" {
			return h.handleGetWork(ctx)
		}
		if path == "/costs" {
			return h.handleGetCosts(ctx)
		}
		if strings.HasPrefix(path, "/bookings/") {
			return h.handleGetBooking(ctx, strings.TrimPrefix(path, "/bookings/"))
		}
	case http.MethodPut:
		if strings.HasPrefix(path, "/trip/") {
			return h.handleUpdateTrip(ctx, request, strings.TrimPrefix(path, "/trip/"))
		}
		if strings.HasPrefix(path, "/fuel/") {
			return h.handleUpdateFuel(ctx, request, strings.TrimPrefix(path, "/fuel/"))
		}
		if strings.HasPrefix(path, "/bookings/") {
			return h.handleUpdateBooking(ctx, request, strings.TrimPrefix(path, "/bookings/"))
		}
		if path == "/work" {
			return h.handlePutWork(ctx, request)
		}
		if path == "/costs" {
			return h.handlePutCosts(ctx, request)
		}
	case http.MethodDelete:
		if strings.HasPrefix(path, "/trip/") {
			return h.handleDeleteTrip(ctx, strings.TrimPrefix(path, "/trip/"))
		}
		if strings.HasPrefix(path, "/bookings/") {
			return h.handleDeleteBooking(ctx, strings.TrimPrefix(path, "/bookings/"))
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

	if err := validateTripCreatePayload(payload); err != nil {
		return h.respondError(http.StatusBadRequest, err.Error()), nil
	}

	now := time.Now().UTC()
	openTrip, err := h.getLatestOpenTrip(ctx)
	if err != nil {
		log.Printf("fetch open trip failed: %v", err)
		return h.respondError(http.StatusInternalServerError, "failed to validate trip"), nil
	}

	if payload.StartKM != nil && payload.EndKM == nil {
		if openTrip != nil {
			return h.respondError(http.StatusBadRequest, "an open trip already exists; submit an end_km to close it first"), nil
		}
		itemID := uuid.NewString()
		item := map[string]types.AttributeValue{
			"id":             &types.AttributeValueMemberS{Value: itemID},
			"timestamp":      &types.AttributeValueMemberS{Value: now.Format(time.RFC3339)},
			"user_name":      &types.AttributeValueMemberS{Value: payload.UserName},
			"start_km":       &types.AttributeValueMemberN{Value: fmt.Sprintf("%.2f", *payload.StartKM)},
			"event_type":     &types.AttributeValueMemberS{Value: "trip_manual_open"},
			"ledger_comment": &types.AttributeValueMemberS{Value: "Trip start logged. Add end odometer later to close."},
		}
		if _, err := h.db.PutItem(ctx, &dynamodb.PutItemInput{TableName: &h.tableName, Item: item}); err != nil {
			log.Printf("put open trip failed: %v", err)
			return h.respondError(http.StatusInternalServerError, "failed to store trip"), nil
		}
		return h.respond(http.StatusOK, map[string]any{
			"id":            itemID,
			"event_type":    "trip_manual_open",
			"timestamp":     now.Format(time.RFC3339),
			"confirmation":  "Trip start logged. Add end odometer when you finish driving.",
			"is_open":       true,
			"start_km":      *payload.StartKM,
			"user_name":     payload.UserName,
			"trip_cost_chf": 0.0,
			"delta_km":      0.0,
		}), nil
	}

	startKM := 0.0
	userName := payload.UserName
	if payload.StartKM != nil {
		startKM = *payload.StartKM
	}
	if payload.StartKM == nil && payload.EndKM != nil {
		if openTrip == nil {
			return h.respondError(http.StatusBadRequest, "no open trip found; submit start_km first"), nil
		}
		startKM = openTrip.StartKM
		if strings.TrimSpace(userName) == "" {
			userName = openTrip.UserName
		}
		if _, err := h.db.DeleteItem(ctx, &dynamodb.DeleteItemInput{
			TableName: &h.tableName,
			Key: map[string]types.AttributeValue{
				"id": &types.AttributeValueMemberS{Value: openTrip.ID},
			},
		}); err != nil {
			log.Printf("delete open trip failed: %v", err)
			return h.respondError(http.StatusInternalServerError, "failed to store trip"), nil
		}
	}

	endKM := *payload.EndKM
	if endKM <= startKM {
		return h.respondError(http.StatusBadRequest, "end_km must be greater than start_km"), nil
	}

	deltaKM := endKM - startKM
	tripCost := deltaKM * 0.50
	itemID := uuid.NewString()
	item := map[string]types.AttributeValue{
		"id":             &types.AttributeValueMemberS{Value: itemID},
		"timestamp":      &types.AttributeValueMemberS{Value: now.Format(time.RFC3339)},
		"user_name":      &types.AttributeValueMemberS{Value: userName},
		"start_km":       &types.AttributeValueMemberN{Value: fmt.Sprintf("%.2f", startKM)},
		"end_km":         &types.AttributeValueMemberN{Value: fmt.Sprintf("%.2f", endKM)},
		"delta_km":       &types.AttributeValueMemberN{Value: fmt.Sprintf("%.2f", deltaKM)},
		"trip_cost_chf":  &types.AttributeValueMemberN{Value: fmt.Sprintf("%.2f", tripCost)},
		"event_type":     &types.AttributeValueMemberS{Value: "trip_manual"},
		"ledger_comment": &types.AttributeValueMemberS{Value: "Append-only MVP entry. Corrections are new events."},
	}
	if _, err := h.db.PutItem(ctx, &dynamodb.PutItemInput{TableName: &h.tableName, Item: item}); err != nil {
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

func (h *handler) handleGetOpenTrip(ctx context.Context) (events.APIGatewayV2HTTPResponse, error) {
	openTrip, err := h.getLatestOpenTrip(ctx)
	if err != nil {
		log.Printf("scan failed: %v", err)
		return h.respondError(http.StatusInternalServerError, "failed to fetch open trip"), nil
	}
	if openTrip == nil {
		return h.respond(http.StatusOK, map[string]any{"item": nil}), nil
	}
	return h.respond(http.StatusOK, map[string]any{
		"item": openTripResponse{
			ID:        openTrip.ID,
			Timestamp: openTrip.Timestamp,
			UserName:  openTrip.UserName,
			StartKM:   openTrip.StartKM,
		},
	}), nil
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

func (h *handler) handleGetIntakeContext(ctx context.Context) (events.APIGatewayV2HTTPResponse, error) {
	events, err := h.listEvents(ctx)
	if err != nil {
		log.Printf("scan failed: %v", err)
		return h.respondError(http.StatusInternalServerError, "failed to fetch intake context"), nil
	}

	openTrip, err := h.getLatestOpenTrip(ctx)
	if err != nil {
		log.Printf("scan open trip failed: %v", err)
		return h.respondError(http.StatusInternalServerError, "failed to fetch intake context"), nil
	}

	contextByPerson, suggestedStartKM := buildIntakeContext(events, openTrip)
	people := make([]personContext, 0, len(contextByPerson))
	for _, person := range contextByPerson {
		people = append(people, person)
	}
	sort.Slice(people, func(i, j int) bool {
		return strings.ToLower(people[i].Name) < strings.ToLower(people[j].Name)
	})

	return h.respond(http.StatusOK, map[string]any{
		"people":             people,
		"open_trip":          openTrip,
		"suggested_start_km": suggestedStartKM,
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

	if err := validateTripUpdatePayload(payload); err != nil {
		return h.respondError(http.StatusBadRequest, err.Error()), nil
	}

	trips, err := h.listTrips(ctx)
	if err != nil {
		log.Printf("scan failed: %v", err)
		return h.respondError(http.StatusInternalServerError, "failed to validate trip"), nil
	}
	if err := validateTripUpdate(*payload.StartKM, *payload.EndKM, trips, id); err != nil {
		return h.respondError(http.StatusBadRequest, err.Error()), nil
	}

	now := time.Now().UTC()
	deltaKM := *payload.EndKM - *payload.StartKM
	tripCost := deltaKM * 0.50

	item := map[string]types.AttributeValue{
		"id":             &types.AttributeValueMemberS{Value: id},
		"timestamp":      &types.AttributeValueMemberS{Value: now.Format(time.RFC3339)},
		"user_name":      &types.AttributeValueMemberS{Value: payload.UserName},
		"start_km":       &types.AttributeValueMemberN{Value: fmt.Sprintf("%.2f", *payload.StartKM)},
		"end_km":         &types.AttributeValueMemberN{Value: fmt.Sprintf("%.2f", *payload.EndKM)},
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

func (h *handler) handleUpdateFuel(ctx context.Context, request events.APIGatewayV2HTTPRequest, id string) (events.APIGatewayV2HTTPResponse, error) {
	if strings.TrimSpace(id) == "" {
		return h.respondError(http.StatusBadRequest, "fuel id is required"), nil
	}

	var payload fuelRequest
	if err := json.Unmarshal([]byte(request.Body), &payload); err != nil {
		return h.respondError(http.StatusBadRequest, "invalid json payload"), nil
	}

	if err := validateFuel(payload); err != nil {
		return h.respondError(http.StatusBadRequest, err.Error()), nil
	}

	now := time.Now().UTC()
	item := map[string]types.AttributeValue{
		"id":             &types.AttributeValueMemberS{Value: id},
		"timestamp":      &types.AttributeValueMemberS{Value: now.Format(time.RFC3339)},
		"user_name":      &types.AttributeValueMemberS{Value: payload.UserName},
		"odometer_km":    &types.AttributeValueMemberN{Value: fmt.Sprintf("%.2f", payload.OdometerKM)},
		"liters":         &types.AttributeValueMemberN{Value: fmt.Sprintf("%.2f", payload.Liters)},
		"fuel_cost_chf":  &types.AttributeValueMemberN{Value: fmt.Sprintf("%.2f", payload.FuelCostCHF)},
		"event_type":     &types.AttributeValueMemberS{Value: "fuel_manual_updated"},
		"ledger_comment": &types.AttributeValueMemberS{Value: "Fuel entry updated to resolve data mistakes."},
	}

	_, err := h.db.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: &h.tableName,
		Item:      item,
	})
	if err != nil {
		log.Printf("update fuel item failed: %v", err)
		return h.respondError(http.StatusInternalServerError, "failed to update fuel event"), nil
	}

	return h.respond(http.StatusOK, map[string]any{
		"id":            id,
		"timestamp":     now.Format(time.RFC3339),
		"event_type":    "fuel_manual_updated",
		"fuel_cost_chf": payload.FuelCostCHF,
		"confirmation":  "Fuel event updated.",
	}), nil
}

func (h *handler) listBookings(ctx context.Context) ([]bookingRecord, error) {
	result, err := h.db.Scan(ctx, &dynamodb.ScanInput{
		TableName: &h.bookingTableName,
	})
	if err != nil {
		return nil, err
	}

	bookings := make([]bookingRecord, 0, len(result.Items))
	for _, item := range result.Items {
		booking, parseErr := parseBookingRecord(item)
		if parseErr != nil {
			log.Printf("skipping malformed booking item: %v", parseErr)
			continue
		}
		bookings = append(bookings, booking)
	}
	return bookings, nil
}

func (h *handler) handleCreateBooking(ctx context.Context, request events.APIGatewayV2HTTPRequest) (events.APIGatewayV2HTTPResponse, error) {
	var payload bookingRequest
	if err := json.Unmarshal([]byte(request.Body), &payload); err != nil {
		return h.respondError(http.StatusBadRequest, "invalid json payload"), nil
	}

	normalized, err := normalizeAndValidateBooking(payload)
	if err != nil {
		return h.respondError(http.StatusBadRequest, err.Error()), nil
	}

	bookings, err := h.listBookings(ctx)
	if err != nil {
		log.Printf("scan bookings failed: %v", err)
		return h.respondError(http.StatusInternalServerError, "failed to validate booking overlap"), nil
	}
	if err := validateBookingOverlap(normalized, bookings, ""); err != nil {
		return h.respondError(http.StatusBadRequest, err.Error()), nil
	}

	now := time.Now().UTC().Format(time.RFC3339)
	id := uuid.NewString()

	item := bookingItemFromRecord(id, normalized, now, "")
	_, err = h.db.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: &h.bookingTableName,
		Item:      item,
	})
	if err != nil {
		log.Printf("put booking item failed: %v", err)
		return h.respondError(http.StatusInternalServerError, "failed to store booking"), nil
	}

	created := normalized
	created.ID = id
	created.CreatedAt = now
	created.UpdatedAt = now
	return h.respond(http.StatusOK, created), nil
}

func (h *handler) handleListBookings(ctx context.Context, request events.APIGatewayV2HTTPRequest) (events.APIGatewayV2HTTPResponse, error) {
	bookings, err := h.listBookings(ctx)
	if err != nil {
		log.Printf("scan bookings failed: %v", err)
		return h.respondError(http.StatusInternalServerError, "failed to fetch bookings"), nil
	}

	fromDate, err := parseOptionalDate(request.QueryStringParameters["from"])
	if err != nil {
		return h.respondError(http.StatusBadRequest, "invalid from date; expected YYYY-MM-DD"), nil
	}
	toDate, err := parseOptionalDate(request.QueryStringParameters["to"])
	if err != nil {
		return h.respondError(http.StatusBadRequest, "invalid to date; expected YYYY-MM-DD"), nil
	}
	if fromDate != nil && toDate != nil && !fromDate.Before(*toDate) {
		return h.respondError(http.StatusBadRequest, "from must be before to"), nil
	}

	filtered := make([]bookingRecord, 0, len(bookings))
	for _, booking := range bookings {
		if bookingOverlapsRange(booking, fromDate, toDate) {
			filtered = append(filtered, booking)
		}
	}

	sort.Slice(filtered, func(i, j int) bool {
		if filtered[i].StartDate == filtered[j].StartDate {
			return filtered[i].ID < filtered[j].ID
		}
		return filtered[i].StartDate < filtered[j].StartDate
	})

	return h.respond(http.StatusOK, map[string]any{"items": filtered}), nil
}

func (h *handler) handleGetBooking(ctx context.Context, id string) (events.APIGatewayV2HTTPResponse, error) {
	booking, err := h.getBookingByID(ctx, id)
	if err != nil {
		if errors.Is(err, errBookingNotFound) {
			return h.respondError(http.StatusNotFound, "booking not found"), nil
		}
		log.Printf("get booking failed: %v", err)
		return h.respondError(http.StatusInternalServerError, "failed to fetch booking"), nil
	}
	return h.respond(http.StatusOK, booking), nil
}

func (h *handler) handleUpdateBooking(ctx context.Context, request events.APIGatewayV2HTTPRequest, id string) (events.APIGatewayV2HTTPResponse, error) {
	if strings.TrimSpace(id) == "" {
		return h.respondError(http.StatusBadRequest, "booking id is required"), nil
	}

	existing, err := h.getBookingByID(ctx, id)
	if err != nil {
		if errors.Is(err, errBookingNotFound) {
			return h.respondError(http.StatusNotFound, "booking not found"), nil
		}
		log.Printf("get booking failed: %v", err)
		return h.respondError(http.StatusInternalServerError, "failed to update booking"), nil
	}

	var payload bookingRequest
	if err := json.Unmarshal([]byte(request.Body), &payload); err != nil {
		return h.respondError(http.StatusBadRequest, "invalid json payload"), nil
	}

	normalized, err := normalizeAndValidateBooking(payload)
	if err != nil {
		return h.respondError(http.StatusBadRequest, err.Error()), nil
	}

	bookings, err := h.listBookings(ctx)
	if err != nil {
		log.Printf("scan bookings failed: %v", err)
		return h.respondError(http.StatusInternalServerError, "failed to validate booking overlap"), nil
	}
	if err := validateBookingOverlap(normalized, bookings, id); err != nil {
		return h.respondError(http.StatusBadRequest, err.Error()), nil
	}

	updatedAt := time.Now().UTC().Format(time.RFC3339)
	normalized.ID = id
	normalized.CreatedAt = existing.CreatedAt
	normalized.UpdatedAt = updatedAt

	item := bookingItemFromRecord(id, normalized, updatedAt, existing.CreatedAt)
	_, err = h.db.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: &h.bookingTableName,
		Item:      item,
	})
	if err != nil {
		log.Printf("update booking failed: %v", err)
		return h.respondError(http.StatusInternalServerError, "failed to update booking"), nil
	}

	return h.respond(http.StatusOK, normalized), nil
}

func (h *handler) handleDeleteBooking(ctx context.Context, id string) (events.APIGatewayV2HTTPResponse, error) {
	if strings.TrimSpace(id) == "" {
		return h.respondError(http.StatusBadRequest, "booking id is required"), nil
	}
	_, err := h.db.DeleteItem(ctx, &dynamodb.DeleteItemInput{
		TableName: &h.bookingTableName,
		Key: map[string]types.AttributeValue{
			"id": &types.AttributeValueMemberS{Value: id},
		},
	})
	if err != nil {
		log.Printf("delete booking failed: %v", err)
		return h.respondError(http.StatusInternalServerError, "failed to delete booking"), nil
	}
	return h.respond(http.StatusOK, map[string]string{"status": "deleted"}), nil
}

func (h *handler) handleGetWork(ctx context.Context) (events.APIGatewayV2HTTPResponse, error) {
	result, err := h.db.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: &h.workTableName,
		Key: map[string]types.AttributeValue{
			"id": &types.AttributeValueMemberS{Value: "work-state"},
		},
	})
	if err != nil {
		log.Printf("get work state failed: %v", err)
		return h.respondError(http.StatusInternalServerError, "failed to fetch work state"), nil
	}
	if len(result.Item) == 0 {
		return h.respond(http.StatusOK, workStatePayload{
			Tasks: []map[string]any{},
			Todos: []map[string]any{},
			Board: []map[string]any{},
		}), nil
	}

	payloadAttr, ok := result.Item["payload"].(*types.AttributeValueMemberS)
	if !ok {
		return h.respondError(http.StatusInternalServerError, "stored work payload is invalid"), nil
	}

	var state workStatePayload
	if err := json.Unmarshal([]byte(payloadAttr.Value), &state); err != nil {
		log.Printf("unmarshal work state failed: %v", err)
		return h.respondError(http.StatusInternalServerError, "stored work payload is invalid json"), nil
	}
	return h.respond(http.StatusOK, state), nil
}

func (h *handler) handlePutWork(ctx context.Context, request events.APIGatewayV2HTTPRequest) (events.APIGatewayV2HTTPResponse, error) {
	normalized, err := normalizeAndValidateWorkPayload([]byte(request.Body))
	if err != nil {
		return h.respondError(http.StatusBadRequest, err.Error()), nil
	}

	item := map[string]types.AttributeValue{
		"id":         &types.AttributeValueMemberS{Value: "work-state"},
		"payload":    &types.AttributeValueMemberS{Value: string(normalized)},
		"updated_at": &types.AttributeValueMemberS{Value: time.Now().UTC().Format(time.RFC3339)},
	}
	_, err = h.db.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: &h.workTableName,
		Item:      item,
	})
	if err != nil {
		log.Printf("put work state failed: %v", err)
		return h.respondError(http.StatusInternalServerError, "failed to store work state"), nil
	}

	var state workStatePayload
	if err := json.Unmarshal(normalized, &state); err != nil {
		log.Printf("normalized work payload unmarshal failed: %v", err)
		return h.respondError(http.StatusInternalServerError, "failed to read normalized work state"), nil
	}
	return h.respond(http.StatusOK, state), nil
}

func (h *handler) handleGetCosts(ctx context.Context) (events.APIGatewayV2HTTPResponse, error) {
	result, err := h.db.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: &h.workTableName,
		Key: map[string]types.AttributeValue{
			"id": &types.AttributeValueMemberS{Value: "cost-state"},
		},
	})
	if err != nil {
		log.Printf("get cost state failed: %v", err)
		return h.respondError(http.StatusInternalServerError, "failed to fetch cost state"), nil
	}
	if len(result.Item) == 0 {
		return h.respond(http.StatusOK, costStatePayload{Entries: []costEntryPayload{}}), nil
	}

	payloadAttr, ok := result.Item["payload"].(*types.AttributeValueMemberS)
	if !ok {
		return h.respondError(http.StatusInternalServerError, "stored cost payload is invalid"), nil
	}

	var state costStatePayload
	if err := json.Unmarshal([]byte(payloadAttr.Value), &state); err != nil {
		log.Printf("unmarshal cost state failed: %v", err)
		return h.respondError(http.StatusInternalServerError, "stored cost payload is invalid json"), nil
	}
	return h.respond(http.StatusOK, state), nil
}

func (h *handler) handlePutCosts(ctx context.Context, request events.APIGatewayV2HTTPRequest) (events.APIGatewayV2HTTPResponse, error) {
	normalized, err := normalizeAndValidateCostPayload([]byte(request.Body))
	if err != nil {
		return h.respondError(http.StatusBadRequest, err.Error()), nil
	}

	item := map[string]types.AttributeValue{
		"id":         &types.AttributeValueMemberS{Value: "cost-state"},
		"payload":    &types.AttributeValueMemberS{Value: string(normalized)},
		"updated_at": &types.AttributeValueMemberS{Value: time.Now().UTC().Format(time.RFC3339)},
	}
	_, err = h.db.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: &h.workTableName,
		Item:      item,
	})
	if err != nil {
		log.Printf("put cost state failed: %v", err)
		return h.respondError(http.StatusInternalServerError, "failed to store cost state"), nil
	}

	var state costStatePayload
	if err := json.Unmarshal(normalized, &state); err != nil {
		log.Printf("normalized cost payload unmarshal failed: %v", err)
		return h.respondError(http.StatusInternalServerError, "failed to read normalized cost state"), nil
	}
	return h.respond(http.StatusOK, state), nil
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

var errBookingNotFound = errors.New("booking not found")

func parseBookingRecord(item map[string]types.AttributeValue) (bookingRecord, error) {
	getStringRequired := func(key string) (string, error) {
		value, ok := item[key].(*types.AttributeValueMemberS)
		if !ok {
			return "", fmt.Errorf("%s missing or not string", key)
		}
		return value.Value, nil
	}
	getStringOptional := func(key string) string {
		value, ok := item[key].(*types.AttributeValueMemberS)
		if !ok {
			return ""
		}
		return value.Value
	}
	getNumberRequired := func(key string) (float64, error) {
		value, ok := item[key].(*types.AttributeValueMemberN)
		if !ok {
			return 0, fmt.Errorf("%s missing or not number", key)
		}
		parsed, err := strconv.ParseFloat(value.Value, 64)
		if err != nil {
			return 0, fmt.Errorf("parse %s: %w", key, err)
		}
		return parsed, nil
	}

	id, err := getStringRequired("id")
	if err != nil {
		return bookingRecord{}, err
	}
	startDate, err := getStringRequired("start_date")
	if err != nil {
		return bookingRecord{}, err
	}
	endDate, err := getStringRequired("end_date")
	if err != nil {
		return bookingRecord{}, err
	}
	status, err := getStringRequired("status")
	if err != nil {
		return bookingRecord{}, err
	}
	createdAt, err := getStringRequired("created_at")
	if err != nil {
		return bookingRecord{}, err
	}
	updatedAt, err := getStringRequired("updated_at")
	if err != nil {
		return bookingRecord{}, err
	}
	dayKM, err := getNumberRequired("day_km")
	if err != nil {
		return bookingRecord{}, err
	}
	nightlyRate, err := getNumberRequired("nightly_rate")
	if err != nil {
		return bookingRecord{}, err
	}
	cleaningFee, err := getNumberRequired("cleaning_fee")
	if err != nil {
		return bookingRecord{}, err
	}
	kmRate, err := getNumberRequired("km_rate")
	if err != nil {
		return bookingRecord{}, err
	}
	estimateTotal, err := getNumberRequired("estimate_total")
	if err != nil {
		return bookingRecord{}, err
	}
	nightsRaw, err := getNumberRequired("nights")
	if err != nil {
		return bookingRecord{}, err
	}

	return bookingRecord{
		ID:            id,
		StartDate:     startDate,
		EndDate:       endDate,
		Status:        status,
		GuestName:     getStringOptional("guest_name"),
		Notes:         getStringOptional("notes"),
		DayKM:         dayKM,
		NightlyRate:   nightlyRate,
		CleaningFee:   cleaningFee,
		KMRate:        kmRate,
		EstimateTotal: estimateTotal,
		Nights:        int(nightsRaw),
		CreatedAt:     createdAt,
		UpdatedAt:     updatedAt,
	}, nil
}

func (h *handler) getBookingByID(ctx context.Context, id string) (bookingRecord, error) {
	result, err := h.db.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: &h.bookingTableName,
		Key: map[string]types.AttributeValue{
			"id": &types.AttributeValueMemberS{Value: id},
		},
	})
	if err != nil {
		return bookingRecord{}, err
	}
	if len(result.Item) == 0 {
		return bookingRecord{}, errBookingNotFound
	}
	return parseBookingRecord(result.Item)
}

func normalizeAndValidateBooking(payload bookingRequest) (bookingRecord, error) {
	startDate, err := parseDate(payload.StartDate)
	if err != nil {
		return bookingRecord{}, errors.New("start_date must be in YYYY-MM-DD format")
	}
	endDate, err := parseDate(payload.EndDate)
	if err != nil {
		return bookingRecord{}, errors.New("end_date must be in YYYY-MM-DD format")
	}
	if !startDate.Before(endDate) {
		return bookingRecord{}, errors.New("end_date must be greater than start_date")
	}

	status := strings.TrimSpace(payload.Status)
	if status == "" {
		status = "booked"
	}
	if status != "booked" && status != "blocked" && status != "open_override" {
		return bookingRecord{}, errors.New("status must be booked, blocked, or open_override")
	}

	dayKM := valueOrDefault(payload.DayKM, 0)
	nightlyRate := valueOrDefault(payload.NightlyRate, 100)
	cleaningFee := valueOrDefault(payload.CleaningFee, 100)
	kmRate := valueOrDefault(payload.KMRate, 0.50)

	if dayKM < 0 || nightlyRate < 0 || cleaningFee < 0 || kmRate < 0 {
		return bookingRecord{}, errors.New("day_km, nightly_rate, cleaning_fee, and km_rate must be non-negative")
	}

	nights := int(endDate.Sub(startDate).Hours() / 24)
	estimate := calculateBookingEstimate(nights, nightlyRate, cleaningFee, dayKM, kmRate)

	return bookingRecord{
		StartDate:     startDate.Format("2006-01-02"),
		EndDate:       endDate.Format("2006-01-02"),
		Status:        status,
		GuestName:     safeString(payload.GuestName),
		Notes:         safeString(payload.Notes),
		DayKM:         dayKM,
		NightlyRate:   nightlyRate,
		CleaningFee:   cleaningFee,
		KMRate:        kmRate,
		EstimateTotal: estimate,
		Nights:        nights,
	}, nil
}

func calculateBookingEstimate(nights int, nightlyRate, cleaningFee, dayKM, kmRate float64) float64 {
	total := (float64(nights) * nightlyRate) + cleaningFee + (dayKM * kmRate)
	return roundMoney(total)
}

func validateBookingOverlap(candidate bookingRecord, bookings []bookingRecord, currentID string) error {
	if candidate.Status != "booked" {
		return nil
	}
	for _, booking := range bookings {
		if booking.ID == currentID || booking.Status != "booked" {
			continue
		}
		if rangesOverlap(candidate.StartDate, candidate.EndDate, booking.StartDate, booking.EndDate) {
			return fmt.Errorf("booking overlaps existing booking %s (%s to %s)", booking.ID, booking.StartDate, booking.EndDate)
		}
	}
	return nil
}

func rangesOverlap(startA, endA, startB, endB string) bool {
	return startA < endB && startB < endA
}

func bookingOverlapsRange(booking bookingRecord, fromDate, toDate *time.Time) bool {
	if fromDate == nil && toDate == nil {
		return true
	}

	start, err := parseDate(booking.StartDate)
	if err != nil {
		return false
	}
	end, err := parseDate(booking.EndDate)
	if err != nil {
		return false
	}

	rangeStart := time.Time{}
	rangeEnd := time.Date(9999, 12, 31, 0, 0, 0, 0, time.UTC)
	if fromDate != nil {
		rangeStart = *fromDate
	}
	if toDate != nil {
		rangeEnd = *toDate
	}

	return start.Before(rangeEnd) && rangeStart.Before(end)
}

func parseOptionalDate(value string) (*time.Time, error) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return nil, nil
	}
	parsed, err := parseDate(trimmed)
	if err != nil {
		return nil, err
	}
	return &parsed, nil
}

func parseDate(value string) (time.Time, error) {
	return time.Parse("2006-01-02", strings.TrimSpace(value))
}

func bookingItemFromRecord(id string, booking bookingRecord, updatedAt, existingCreatedAt string) map[string]types.AttributeValue {
	createdAt := existingCreatedAt
	if createdAt == "" {
		createdAt = updatedAt
	}

	item := map[string]types.AttributeValue{
		"id":             &types.AttributeValueMemberS{Value: id},
		"start_date":     &types.AttributeValueMemberS{Value: booking.StartDate},
		"end_date":       &types.AttributeValueMemberS{Value: booking.EndDate},
		"status":         &types.AttributeValueMemberS{Value: booking.Status},
		"day_km":         &types.AttributeValueMemberN{Value: fmt.Sprintf("%.2f", booking.DayKM)},
		"nightly_rate":   &types.AttributeValueMemberN{Value: fmt.Sprintf("%.2f", booking.NightlyRate)},
		"cleaning_fee":   &types.AttributeValueMemberN{Value: fmt.Sprintf("%.2f", booking.CleaningFee)},
		"km_rate":        &types.AttributeValueMemberN{Value: fmt.Sprintf("%.2f", booking.KMRate)},
		"estimate_total": &types.AttributeValueMemberN{Value: fmt.Sprintf("%.2f", booking.EstimateTotal)},
		"nights":         &types.AttributeValueMemberN{Value: strconv.Itoa(booking.Nights)},
		"month_key":      &types.AttributeValueMemberS{Value: booking.StartDate[:7]},
		"created_at":     &types.AttributeValueMemberS{Value: createdAt},
		"updated_at":     &types.AttributeValueMemberS{Value: updatedAt},
	}
	if strings.TrimSpace(booking.GuestName) != "" {
		item["guest_name"] = &types.AttributeValueMemberS{Value: strings.TrimSpace(booking.GuestName)}
	}
	if strings.TrimSpace(booking.Notes) != "" {
		item["notes"] = &types.AttributeValueMemberS{Value: strings.TrimSpace(booking.Notes)}
	}
	return item
}

func valueOrDefault(value *float64, fallback float64) float64 {
	if value == nil {
		return fallback
	}
	return *value
}

func safeString(value *string) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(*value)
}

func normalizeAndValidateWorkPayload(raw []byte) ([]byte, error) {
	if len(strings.TrimSpace(string(raw))) == 0 {
		raw = []byte(`{}`)
	}

	var payload map[string]json.RawMessage
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil, errors.New("invalid json payload")
	}

	readArray := func(key string) ([]map[string]any, error) {
		value, exists := payload[key]
		if !exists || len(value) == 0 {
			return []map[string]any{}, nil
		}
		var out []map[string]any
		if err := json.Unmarshal(value, &out); err != nil {
			return nil, fmt.Errorf("%s must be an array", key)
		}
		return out, nil
	}

	tasks, err := readArray("tasks")
	if err != nil {
		return nil, err
	}
	todos, err := readArray("todos")
	if err != nil {
		return nil, err
	}
	board, err := readArray("board")
	if err != nil {
		return nil, err
	}

	normalized := workStatePayload{
		Tasks: tasks,
		Todos: todos,
		Board: board,
	}
	return json.Marshal(normalized)
}

func normalizeAndValidateCostPayload(raw []byte) ([]byte, error) {
	if len(strings.TrimSpace(string(raw))) == 0 {
		raw = []byte(`{}`)
	}

	var payload map[string]json.RawMessage
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil, errors.New("invalid json payload")
	}

	entriesRaw, exists := payload["entries"]
	if !exists || len(entriesRaw) == 0 {
		return json.Marshal(costStatePayload{Entries: []costEntryPayload{}})
	}

	var entries []costEntryPayload
	if err := json.Unmarshal(entriesRaw, &entries); err != nil {
		return nil, errors.New("entries must be an array")
	}

	now := time.Now().UTC().Format(time.RFC3339)
	normalized := make([]costEntryPayload, 0, len(entries))
	for _, entry := range entries {
		entry.ID = strings.TrimSpace(entry.ID)
		entry.Date = strings.TrimSpace(entry.Date)
		entry.Type = strings.TrimSpace(strings.ToLower(entry.Type))
		entry.Description = strings.TrimSpace(entry.Description)
		entry.Category = strings.TrimSpace(entry.Category)
		entry.PaidBy = strings.TrimSpace(entry.PaidBy)
		entry.FromPerson = strings.TrimSpace(entry.FromPerson)
		entry.ToPerson = strings.TrimSpace(entry.ToPerson)
		entry.Notes = strings.TrimSpace(entry.Notes)
		if entry.ID == "" || entry.Date == "" || entry.Description == "" || entry.Category == "" {
			return nil, errors.New("each entry requires id, date, description, and category")
		}
		if _, err := parseDate(entry.Date); err != nil {
			return nil, fmt.Errorf("invalid date for entry %s; expected YYYY-MM-DD", entry.ID)
		}
		if entry.AmountCHF <= 0 {
			return nil, fmt.Errorf("amount_chf must be greater than 0 for entry %s", entry.ID)
		}
		switch entry.Type {
		case "expense", "income":
			if entry.PaidBy == "" {
				return nil, fmt.Errorf("paid_by is required for %s entry %s", entry.Type, entry.ID)
			}
			participants := make([]string, 0, len(entry.Participants))
			for _, participant := range entry.Participants {
				trimmed := strings.TrimSpace(participant)
				if trimmed != "" {
					participants = append(participants, trimmed)
				}
			}
			if len(participants) == 0 {
				return nil, fmt.Errorf("participants are required for %s entry %s", entry.Type, entry.ID)
			}
			entry.Participants = participants
		case "transfer":
			if entry.FromPerson == "" || entry.ToPerson == "" {
				return nil, fmt.Errorf("from_person and to_person are required for transfer entry %s", entry.ID)
			}
			if entry.FromPerson == entry.ToPerson {
				return nil, fmt.Errorf("from_person and to_person must differ for transfer entry %s", entry.ID)
			}
			entry.Participants = nil
			entry.PaidBy = ""
		default:
			return nil, fmt.Errorf("type must be expense, income, or transfer for entry %s", entry.ID)
		}
		if entry.CreatedAt == "" {
			entry.CreatedAt = now
		}
		entry.UpdatedAt = now
		normalized = append(normalized, entry)
	}

	return json.Marshal(costStatePayload{Entries: normalized})
}

func roundMoney(value float64) float64 {
	return float64(int(value*100+0.5)) / 100
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

func validateTripCreatePayload(payload tripRequest) error {
	if strings.TrimSpace(payload.UserName) == "" {
		return errors.New("user_name is required")
	}
	if payload.StartKM == nil && payload.EndKM == nil {
		return errors.New("provide at least one of start_km or end_km")
	}
	if payload.StartKM != nil && *payload.StartKM < 0 {
		return errors.New("start_km must be greater than or equal to 0")
	}
	if payload.EndKM != nil && *payload.EndKM < 0 {
		return errors.New("end_km must be greater than or equal to 0")
	}
	if payload.StartKM != nil && payload.EndKM != nil && *payload.EndKM <= *payload.StartKM {
		return errors.New("end_km must be greater than start_km")
	}
	return nil
}

func validateTripUpdatePayload(payload tripRequest) error {
	if strings.TrimSpace(payload.UserName) == "" {
		return errors.New("user_name is required")
	}
	if payload.StartKM == nil || payload.EndKM == nil {
		return errors.New("both start_km and end_km are required when editing")
	}
	if *payload.StartKM < 0 {
		return errors.New("start_km must be greater than or equal to 0")
	}
	if *payload.EndKM <= *payload.StartKM {
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

func validateTripUpdate(startKM float64, endKM float64, trips []tripRecord, currentID string) error {
	if currentID == "" {
		return errors.New("trip id is required")
	}

	for _, trip := range trips {
		if trip.ID == currentID {
			continue
		}
		if startKM < trip.EndKM && endKM > trip.StartKM {
			return fmt.Errorf("edited range %.1f-%.1f overlaps existing trip %.1f-%.1f", startKM, endKM, trip.StartKM, trip.EndKM)
		}
	}

	return nil
}

func buildIntakeContext(events []eventRecord, openTrip *tripRecord) (map[string]personContext, *float64) {
	people := map[string]personContext{}
	var latestTripEndKM *float64
	var latestTripEndAt time.Time

	for _, event := range events {
		name := strings.TrimSpace(event.UserName)
		if name == "" {
			continue
		}

		person := people[name]
		person.Name = name
		eventTime, _ := time.Parse(time.RFC3339, event.Timestamp)
		if person.LastActivityAtUTC == "" || event.Timestamp > person.LastActivityAtUTC {
			person.LastActivityAtUTC = event.Timestamp
		}

		if event.EventType == "trip_manual" {
			if event.StartKM != nil {
				v := *event.StartKM
				person.LastTripStartKM = &v
			}
			if event.EndKM != nil {
				v := *event.EndKM
				person.LastTripEndKM = &v
				if latestTripEndKM == nil || eventTime.After(latestTripEndAt) {
					latestTripEndKM = &v
					latestTripEndAt = eventTime
				}
			}
		}
		if event.EventType == "fuel_manual" && event.OdometerKM != nil {
			v := *event.OdometerKM
			person.LastFuelOdometer = &v
		}
		people[name] = person
	}

	if openTrip != nil {
		name := strings.TrimSpace(openTrip.UserName)
		if name != "" {
			person := people[name]
			person.Name = name
			person.HasOpenTrip = true
			v := openTrip.StartKM
			person.OpenTripStartKM = &v
			if person.LastActivityAtUTC == "" || openTrip.Timestamp > person.LastActivityAtUTC {
				person.LastActivityAtUTC = openTrip.Timestamp
			}
			people[name] = person
		}
	}

	return people, latestTripEndKM
}

func (h *handler) getLatestOpenTrip(ctx context.Context) (*tripRecord, error) {
	events, err := h.listEvents(ctx)
	if err != nil {
		return nil, err
	}

	var latest *tripRecord
	for _, event := range events {
		if event.EventType != "trip_manual_open" || event.StartKM == nil || event.EndKM != nil {
			continue
		}
		candidate := &tripRecord{
			ID:        event.ID,
			Timestamp: event.Timestamp,
			UserName:  event.UserName,
			StartKM:   *event.StartKM,
		}
		if latest == nil || candidate.Timestamp > latest.Timestamp {
			latest = candidate
		}
	}
	return latest, nil
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
