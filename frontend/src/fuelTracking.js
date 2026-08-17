const timestampValue = (entry) => new Date(entry?.timestamp || "").getTime();

export const hasKnownOdometer = (entry) => Number.isFinite(entry?.odometer_km) && entry.odometer_km > 0;

export const fuelEfficiencyStatus = (entry) => {
  if (entry?.missed) {
    return hasKnownOdometer(entry) ? "Calculation skipped" : "No odometer · calculation skipped";
  }
  if (!hasKnownOdometer(entry)) {
    return "No odometer · calculation skipped";
  }
  if (entry?.partial) {
    return "Partial fill · carried forward";
  }
  return "Eligible for km/L";
};

export const isSuspiciousFuelEfficiency = (interval) =>
  Number.isFinite(interval?.liters_per_100km) && interval.liters_per_100km < 10;

export const compareFuelEntriesByTime = (a, b) => timestampValue(a) - timestampValue(b);

export const compareKnownFuelEntriesByOdometer = (a, b) => {
  if (a.odometer_km !== b.odometer_km) {
    return a.odometer_km - b.odometer_km;
  }
  return compareFuelEntriesByTime(a, b);
};

export const missedMarkerFallsBetweenFills = (marker, previousFill, currentFill) => {
  if (!marker?.missed || !previousFill || !currentFill) {
    return false;
  }

  if (hasKnownOdometer(marker)) {
    return marker.odometer_km > previousFill.odometer_km && marker.odometer_km < currentFill.odometer_km;
  }

  const markerTime = timestampValue(marker);
  return markerTime > timestampValue(previousFill) && markerTime < timestampValue(currentFill);
};

export const fuelDataGapFallsBetweenFills = (entry, previousFill, currentFill) => {
  if (!entry || !previousFill || !currentFill) {
    return false;
  }
  if (entry.missed && hasKnownOdometer(entry)) {
    return entry.odometer_km > previousFill.odometer_km && entry.odometer_km < currentFill.odometer_km;
  }
  const entryTime = timestampValue(entry);
  return entryTime > timestampValue(previousFill) && entryTime < timestampValue(currentFill);
};

export const findNeighboringKnownFills = (marker, entries) => {
  const knownFills = entries.filter((entry) => !entry.missed && !entry.partial && hasKnownOdometer(entry));
  const ordered = [...knownFills].sort(hasKnownOdometer(marker) ? compareKnownFuelEntriesByOdometer : compareFuelEntriesByTime);
  const markerPosition = hasKnownOdometer(marker) ? marker.odometer_km : timestampValue(marker);
  const positionFor = hasKnownOdometer(marker) ? (entry) => entry.odometer_km : timestampValue;

  let previous = null;
  let next = null;
  ordered.forEach((entry) => {
    if (positionFor(entry) < markerPosition) {
      previous = entry;
    } else if (next === null && positionFor(entry) > markerPosition) {
      next = entry;
    }
  });

  return { previous, next };
};

export const buildFuelEfficiencyIntervals = (entries, trips) => {
  const orderedTrips = [...trips].sort((a, b) => {
    if (a.start_km !== b.start_km) {
      return a.start_km - b.start_km;
    }
    return timestampValue(a) - timestampValue(b);
  });
  const calculationBreaks = entries.filter((entry) => entry.missed || !hasKnownOdometer(entry));
  const measuredFills = entries
    .filter((entry) => !entry.missed && hasKnownOdometer(entry))
    .sort(compareKnownFuelEntriesByOdometer);

  const distanceBetween = (startKm, endKm) => {
    if (!(Number.isFinite(startKm) && Number.isFinite(endKm)) || endKm <= startKm) {
      return 0;
    }
    return orderedTrips.reduce((sum, trip) => {
      const overlapStart = Math.max(startKm, trip.start_km);
      const overlapEnd = Math.min(endKm, trip.end_km);
      return overlapEnd > overlapStart ? sum + (overlapEnd - overlapStart) : sum;
    }, 0);
  };

  const intervals = [];
  let previousFullFill = null;
  let accumulatedLiters = 0;
  let accumulatedCostCHF = 0;
  let partialFillCount = 0;

  measuredFills.forEach((entry) => {
    if (!previousFullFill) {
      if (!entry.partial) {
        previousFullFill = entry;
      }
      return;
    }

    accumulatedLiters += entry.liters;
    accumulatedCostCHF += entry.cost_chf;
    if (entry.partial) {
      partialFillCount += 1;
      return;
    }

    const intervalDistanceKm = distanceBetween(previousFullFill.odometer_km, entry.odometer_km);
    const hasDataGap = calculationBreaks.some((gap) => fuelDataGapFallsBetweenFills(gap, previousFullFill, entry));
    if (!hasDataGap && intervalDistanceKm > 0 && accumulatedLiters > 0) {
      const litersPer100Km = (accumulatedLiters / intervalDistanceKm) * 100;
      const interval = {
        id: entry.id,
        timestamp: entry.timestamp,
        user_name: entry.user_name,
        from_odometer_km: previousFullFill.odometer_km,
        to_odometer_km: entry.odometer_km,
        interval_distance_km: intervalDistanceKm,
        liters: accumulatedLiters,
        cost_chf: accumulatedCostCHF,
        km_per_liter: intervalDistanceKm / accumulatedLiters,
        liters_per_100km: litersPer100Km,
        cost_per_100km: (accumulatedCostCHF / intervalDistanceKm) * 100,
        partial_fill_count: partialFillCount,
      };
      interval.suspicious = isSuspiciousFuelEfficiency(interval);
      intervals.push(interval);
    }

    previousFullFill = entry;
    accumulatedLiters = 0;
    accumulatedCostCHF = 0;
    partialFillCount = 0;
  });

  return intervals;
};
