/** The hotel's own photos, used when a room type has no real photo of its own. */
export const ROOM_PHOTO = "/images/room-red/room-red-05.webp";
export const SUITE_PHOTO = "/images/room-red/room-red-07.webp";
export const MEETING_PHOTO = "/images/meeting/meeting-01.webp";

/**
 * Real photos only. A guest sitting in the room should never see stock photos (under /images/illustrative/) passed off
 * as that room, so they are dropped. When nothing real is left, the hotel's own fallback photo is used.
 */
export function realPhotos(photos: readonly string[], fallback: string): string[] {
  const real = photos.filter((p) => !p.includes("/illustrative/"));
  return real.length ? real : [fallback];
}
