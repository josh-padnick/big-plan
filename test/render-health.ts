// Owns classification of browser errors that do not violate render health.

type RuntimeBackpressureError = {
  readonly text: string;
  readonly locationUrl: string;
  readonly pageUrl: string;
};

export const isRuntimeBackpressureError = ({
  text,
  locationUrl,
  pageUrl,
}: RuntimeBackpressureError): boolean => {
  if (!text.includes("status of 503 (Service Unavailable)")) return false;

  try {
    const location = new URL(locationUrl);
    const page = new URL(pageUrl);
    return (
      location.origin === page.origin && location.pathname.startsWith("/api/")
    );
  } catch {
    return false;
  }
};
