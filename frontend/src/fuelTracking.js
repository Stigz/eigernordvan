const timestampValue = (entry) => new Date(entry?.timestamp || "").getTime();

export const hasKnownOdometer = (entry) => Number.isFinite(entry?.odometer_km) && entry.odometer_km > 0;

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

export const findNeighboringKnownFills = (marker, entries) => {
  const knownFills = entries.filter((entry) => !entry.missed && hasKnownOdometer(entry));
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
