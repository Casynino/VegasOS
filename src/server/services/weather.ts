import "server-only";

/**
 * Current weather at the hotel (Mlimani City, Dar es Salaam) from Open-Meteo —
 * free, no API key. Cached for 30 minutes; any failure returns null and the
 * UI simply shows the local time instead. Never invented.
 */
const URL =
  "https://api.open-meteo.com/v1/forecast?latitude=-6.7726&longitude=39.2310&current=temperature_2m,apparent_temperature,weather_code,is_day&timezone=Africa%2FDar_es_Salaam";

export type WeatherKind = "clear" | "partly" | "cloudy" | "fog" | "rain" | "storm";
export interface HotelWeather { temp: number; feelsLike: number; kind: WeatherKind; label: string; isDay: boolean }

function describe(code: number): { kind: WeatherKind; label: string } {
  if (code === 0) return { kind: "clear", label: "Clear sky" };
  if (code <= 2) return { kind: "partly", label: "Partly cloudy" };
  if (code === 3) return { kind: "cloudy", label: "Overcast" };
  if (code <= 48) return { kind: "fog", label: "Fog" };
  if (code >= 95) return { kind: "storm", label: "Thunderstorm" };
  return { kind: "rain", label: code >= 80 ? "Showers" : "Rain" };
}

export async function getHotelWeather(): Promise<HotelWeather | null> {
  try {
    const res = await fetch(URL, { next: { revalidate: 1800 }, signal: AbortSignal.timeout(2500) });
    if (!res.ok) return null;
    const j = (await res.json()) as { current?: { temperature_2m?: number; apparent_temperature?: number; weather_code?: number; is_day?: number } };
    const c = j.current;
    if (!c || typeof c.temperature_2m !== "number" || typeof c.weather_code !== "number") return null;
    return {
      temp: Math.round(c.temperature_2m),
      feelsLike: Math.round(c.apparent_temperature ?? c.temperature_2m),
      isDay: c.is_day === 1,
      ...describe(c.weather_code),
    };
  } catch {
    return null;
  }
}
