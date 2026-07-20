import { ActivatedRoute, ActivatedRouteSnapshot } from '@angular/router';

function positiveNumber(value: string | null): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function routeParameter(route: ActivatedRoute, name: string): number | null {
  let current: ActivatedRoute | null = route;
  while (current) {
    const value = positiveNumber(current.snapshot.paramMap.get(name));
    if (value !== null) return value;
    current = current.parent;
  }
  return null;
}

export function snapshotParameter(route: ActivatedRouteSnapshot, name: string): number | null {
  let current: ActivatedRouteSnapshot | null = route;
  while (current) {
    const value = positiveNumber(current.paramMap.get(name));
    if (value !== null) return value;
    current = current.parent;
  }
  return null;
}

export function queryParameter(route: ActivatedRoute, name: string): number | null {
  return positiveNumber(route.snapshot.queryParamMap.get(name));
}
