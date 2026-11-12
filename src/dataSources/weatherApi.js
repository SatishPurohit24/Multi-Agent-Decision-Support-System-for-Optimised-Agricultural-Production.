/**
 * Open-Meteo — completely free, no API key, no signup.
 * Bonus: it also exposes soil moisture data, so one call feeds both
 * the Weather Agent AND the Soil Agent.
 */
export async function fetchWeatherAndSoil(lat, lon) {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&hourly=precipitation_probability,soil_moisture_0_to_1cm` +
    `&daily=precipitation_sum&forecast_days=3&timezone=auto`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Weather API error: ${res.status}`);
  const data = await res.json();

  const nextRainProb = Math.max(...data.hourly.precipitation_probability.slice(0, 12));
  const soilMoisture = data.hourly.soil_moisture_0_to_1cm[0];

  return {
    rain_probability_next_12h: nextRainProb,
    soil_moisture_m3m3: soilMoisture,
    daily_precip_forecast_mm: data.daily.precipitation_sum
  };
}
