export const buildKmModeOptions = (hasOpenTrip) => {
  if (hasOpenTrip) {
    return [
      { id: "end", label: "End open drive", description: "Close the currently open drive with end KM." },
      { id: "both", label: "Start + end now", description: "Log a completed drive in one step." },
    ];
  }

  return [
    { id: "start", label: "Start new drive", description: "Open a drive with start KM only." },
    { id: "both", label: "Start + end now", description: "Log a completed drive in one step." },
  ];
};

export const collectRecentPeople = ({ profiles = [], intakePeople = [], trips = [], gasEntries = [] }) => {
  const scoreByName = new Map();

  profiles.forEach((name, index) => {
    if (typeof name !== "string" || !name.trim()) {
      return;
    }
    const normalized = name.trim();
    scoreByName.set(normalized, Math.max(scoreByName.get(normalized) ?? 0, 1_000_000 - index));
  });

  intakePeople.forEach((person, index) => {
    const name = typeof person?.name === "string" ? person.name.trim() : "";
    if (!name) {
      return;
    }
    scoreByName.set(name, Math.max(scoreByName.get(name) ?? 0, 2_000_000 - index));
  });

  trips.forEach((trip) => {
    const name = typeof trip?.user_name === "string" ? trip.user_name.trim() : "";
    if (!name) {
      return;
    }
    const stamp = Number(new Date(trip.timestamp || 0));
    scoreByName.set(name, Math.max(scoreByName.get(name) ?? 0, Number.isFinite(stamp) ? stamp : 0));
  });

  gasEntries.forEach((entry) => {
    const name = typeof entry?.user_name === "string" ? entry.user_name.trim() : "";
    if (!name) {
      return;
    }
    const stamp = Number(new Date(entry.timestamp || 0));
    scoreByName.set(name, Math.max(scoreByName.get(name) ?? 0, Number.isFinite(stamp) ? stamp : 0));
  });

  return [...scoreByName.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name]) => name);
};
