export type PublicAttendanceSettings = {
  geofenceEnabled: boolean;
  officeLatitude: number | null;
  officeLongitude: number | null;
  geofenceRadiusMeters: number | null;
};

export const DEFAULT_GEOFENCE_RADIUS_METERS = 200;

export function toPublicAttendanceSettings(org: {
  geofenceEnabled: boolean | null;
  officeLatitude: number | null;
  officeLongitude: number | null;
  geofenceRadiusMeters: number | null;
}): PublicAttendanceSettings {
  return {
    geofenceEnabled: org.geofenceEnabled ?? false,
    officeLatitude: org.officeLatitude,
    officeLongitude: org.officeLongitude,
    geofenceRadiusMeters: org.geofenceRadiusMeters,
  };
}

/** Great-circle distance in metres (haversine). */
export function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
