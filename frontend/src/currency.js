export const eurToChfRateUrl = "https://api.frankfurter.dev/v1/latest?base=EUR&symbols=CHF";

export const convertToChf = (amount, currency, eurToChfRate) => {
  const parsedAmount = Number(amount);
  if (!Number.isFinite(parsedAmount) || parsedAmount < 0) {
    return null;
  }

  if (currency === "CHF") {
    return Math.round((parsedAmount + Number.EPSILON) * 100) / 100;
  }

  if (currency !== "EUR" || !Number.isFinite(eurToChfRate) || eurToChfRate <= 0) {
    return null;
  }

  return Math.round((parsedAmount * eurToChfRate + Number.EPSILON) * 100) / 100;
};

export const fetchEurToChfRate = async (fetchImpl = fetch) => {
  const response = await fetchImpl(eurToChfRateUrl);
  if (!response.ok) {
    throw new Error("Could not load the EUR to CHF exchange rate.");
  }

  const payload = await response.json();
  const rate = Number(payload?.rates?.CHF);
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error("The exchange-rate response did not include a valid CHF rate.");
  }

  return { rate, date: String(payload?.date || "") };
};
