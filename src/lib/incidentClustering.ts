/**
 * INCIDENT DUPLICATE CLUSTERING MODULE
 *
 * Deterministic spatial and temporal clustering for citizen emergency reports.
 *
 * Duplicate Criteria:
 * 1. Spatial proximity: Haversine distance <= configured threshold (default 0.5 km = 500m).
 * 2. Time proximity: Creation timestamp difference <= configured threshold (default 2 hours).
 * 3. Exact matching incident type (e.g. 'flooding' matches 'flooding').
 *
 * CRITICAL DATA INTEGRITY:
 * - NEVER automatically merge or erase original citizen evidence.
 * - Structure:
 *     INCIDENT CLUSTER
 *     ├── REPORT A
 *     ├── REPORT B
 *     └── REPORT C
 * - Each original report remains independently preserved in memory and database.
 */

import { calculateDistanceKm as calculateDistance } from './urbanContext';
import type { Incident } from '@/integrations/supabase/incidents';

export const DEFAULT_SPATIAL_THRESHOLD_KM = 0.5; // 500 meters
export const DEFAULT_TIME_THRESHOLD_HOURS = 2.0; // 2 hours

export interface IncidentCluster {
  clusterId: string;
  incidentType: string;
  centerLatitude: number | null;
  centerLongitude: number | null;
  reportCount: number;
  earliestReportAt: string | null;
  latestReportAt: string | null;
  primaryReport: Incident;
  reports: Incident[];
  allPhotos: string[];
  allDescriptions: string[];
}

export interface ClusteringOptions {
  spatialThresholdKm?: number;
  timeThresholdHours?: number;
}

/**
 * Cluster raw incidents into deterministic duplicate groups.
 * Reports without coordinates are grouped only by type and time if descriptions suggest proximity,
 * or kept as individual single-report clusters.
 */
export function clusterIncidents(
  incidents: Incident[],
  options?: ClusteringOptions
): IncidentCluster[] {
  const spatialThreshold = options?.spatialThresholdKm ?? DEFAULT_SPATIAL_THRESHOLD_KM;
  const timeThresholdMs = (options?.timeThresholdHours ?? DEFAULT_TIME_THRESHOLD_HOURS) * 60 * 60 * 1000;

  if (!incidents || incidents.length === 0) {
    return [];
  }

  // Sort incidents chronologically (earliest first)
  const sorted = [...incidents].sort((a, b) => {
    const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return timeA - timeB;
  });

  const clusters: IncidentCluster[] = [];

  for (const incident of sorted) {
    const incType = incident.type || incident.rawType || 'other';
    const incTime = incident.createdAt ? new Date(incident.createdAt).getTime() : null;

    let matchedCluster: IncidentCluster | null = null;

    for (const cluster of clusters) {
      // 1. Must match incident type
      if (cluster.incidentType !== incType) {
        continue;
      }

      // 2. Must match temporal proximity against cluster anchor
      if (incTime !== null && cluster.earliestReportAt !== null) {
        const anchorTime = new Date(cluster.earliestReportAt).getTime();
        if (Math.abs(incTime - anchorTime) > timeThresholdMs) {
          continue;
        }
      }

      // 3. Spatial proximity check
      if (
        incident.hasCoordinates &&
        incident.latitude !== null &&
        incident.longitude !== null &&
        cluster.centerLatitude !== null &&
        cluster.centerLongitude !== null
      ) {
        const distance = calculateDistance(
          incident.latitude,
          incident.longitude,
          cluster.centerLatitude,
          cluster.centerLongitude
        );

        if (distance <= spatialThreshold) {
          matchedCluster = cluster;
          break;
        }
      }
    }

    if (matchedCluster) {
      // Add report to existing cluster
      matchedCluster.reports.push(incident);
      matchedCluster.reportCount = matchedCluster.reports.length;
      matchedCluster.latestReportAt = incident.createdAt ?? matchedCluster.latestReportAt;

      if (incident.photoPath && !matchedCluster.allPhotos.includes(incident.photoPath)) {
        matchedCluster.allPhotos.push(incident.photoPath);
      }
      if (incident.description && !matchedCluster.allDescriptions.includes(incident.description)) {
        matchedCluster.allDescriptions.push(incident.description);
      }
    } else {
      // Create new cluster with this incident as primary anchor
      const newClusterId = incident.id ? `cluster-${incident.id}` : `cluster-${Date.now()}`;
      clusters.push({
        clusterId: newClusterId,
        incidentType: incType,
        centerLatitude: incident.latitude,
        centerLongitude: incident.longitude,
        reportCount: 1,
        earliestReportAt: incident.createdAt,
        latestReportAt: incident.createdAt,
        primaryReport: incident,
        reports: [incident],
        allPhotos: incident.photoPath ? [incident.photoPath] : [],
        allDescriptions: incident.description ? [incident.description] : [],
      });
    }
  }

  return clusters;
}
