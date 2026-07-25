const EARTH_RADIUS_KM = 6371.0088;

// Wu et al. attribute the detected layer to the PMC altitude of ~83 km. L1B
// geolocation reports where the line of sight crosses the ellipsoid (h = 0),
// not where it crosses the cloud layer, so the same physical cloud seen from
// two viewing geometries (e.g. overlapping adjacent orbits near the pole) is
// reported at two different ground positions. This shifts each point back
// toward the sub-satellite track by height * tan(viewing zenith angle) along
// the reported viewing azimuth, using the standard destination-point formula.
export const PMC_CLOUD_HEIGHT_KM = 83;

export function parallaxCorrectedPoint(
  latitude: number,
  longitude: number,
  viewingZenithDeg: number,
  viewingAzimuthDeg: number,
  cloudHeightKm: number = PMC_CLOUD_HEIGHT_KM,
): [number, number] {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)
    || !Number.isFinite(viewingZenithDeg) || !Number.isFinite(viewingAzimuthDeg)) {
    return [longitude, latitude];
  }
  const groundDistanceKm = cloudHeightKm * Math.tan(viewingZenithDeg * Math.PI / 180);
  const angularDistance = groundDistanceKm / EARTH_RADIUS_KM;
  const bearing = viewingAzimuthDeg * Math.PI / 180;
  const lat1 = latitude * Math.PI / 180, lon1 = longitude * Math.PI / 180;
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angularDistance) + Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearing),
  );
  const lon2 = lon1 + Math.atan2(
    Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(lat1),
    Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2),
  );
  return [lon2 * 180 / Math.PI, lat2 * 180 / Math.PI];
}

export type GeolocatedGrid = {
  latitude: Float32Array;
  longitude: Float32Array;
  latitudeBounds?: Float32Array;
  longitudeBounds?: Float32Array;
  viewingZenith?: Float32Array;
  viewingAzimuth?: Float32Array;
};

export type CorrectedGeolocation = {
  latitude: Float32Array;
  longitude: Float32Array;
  latitudeBounds?: Float32Array;
  longitudeBounds?: Float32Array;
};

// Returns the same arrays untouched when viewing angles are unavailable, so
// callers can always merge the result into their pipeline input unconditionally.
export function parallaxCorrectGeolocation(input: GeolocatedGrid, cloudHeightKm = PMC_CLOUD_HEIGHT_KM): CorrectedGeolocation {
  const { latitude, longitude, latitudeBounds, longitudeBounds, viewingZenith, viewingAzimuth } = input;
  if (!viewingZenith || !viewingAzimuth) return { latitude, longitude, latitudeBounds, longitudeBounds };

  const correctedLatitude = new Float32Array(latitude.length);
  const correctedLongitude = new Float32Array(longitude.length);
  for (let i = 0; i < latitude.length; i++) {
    const [lon, lat] = parallaxCorrectedPoint(latitude[i], longitude[i], viewingZenith[i], viewingAzimuth[i], cloudHeightKm);
    correctedLatitude[i] = lat;
    correctedLongitude[i] = lon;
  }

  let correctedLatitudeBounds: Float32Array | undefined;
  let correctedLongitudeBounds: Float32Array | undefined;
  if (latitudeBounds && longitudeBounds) {
    correctedLatitudeBounds = new Float32Array(latitudeBounds.length);
    correctedLongitudeBounds = new Float32Array(longitudeBounds.length);
    for (let i = 0; i < latitude.length; i++) {
      const vza = viewingZenith[i], vaa = viewingAzimuth[i];
      for (let corner = 0; corner < 4; corner++) {
        const offset = i * 4 + corner;
        if (offset >= latitudeBounds.length) continue;
        const [lon, lat] = parallaxCorrectedPoint(latitudeBounds[offset], longitudeBounds[offset], vza, vaa, cloudHeightKm);
        correctedLatitudeBounds[offset] = lat;
        correctedLongitudeBounds[offset] = lon;
      }
    }
  }
  return { latitude: correctedLatitude, longitude: correctedLongitude, latitudeBounds: correctedLatitudeBounds, longitudeBounds: correctedLongitudeBounds };
}
