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

export const namePresets = ["Nic", "Luki", "Kayla", "Jeanne", "Vermietung"];
