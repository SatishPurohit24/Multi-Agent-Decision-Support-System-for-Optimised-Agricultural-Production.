/**
 * data.gov.in / Agmarknet — India's official mandi price dataset.
 * Free, but needs a registered API key (sign up at data.gov.in).
 */
const RESOURCE_ID = '35985678-0d79-46b4-9ed6-6f13308a1d24'; // daily mandi price dataset

export async function fetchMandiPrice(commodity, state) {
  const key = process.env.DATAGOVIN_API_KEY;
  if (!key) throw new Error('Missing DATAGOVIN_API_KEY — copy .env.example to .env and fill it in.');

  const url =
    `https://api.data.gov.in/resource/${RESOURCE_ID}` +
    `?api-key=${key}&format=json&limit=5` +
    `&filters[commodity]=${encodeURIComponent(commodity)}` +
    `&filters[state]=${encodeURIComponent(state)}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Market API error: ${res.status}`);
  const data = await res.json();
  return data.records || [];
}
