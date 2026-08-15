// The routes that serve and accept pictures: the ones an author or agent saved
// beside the plan, and the ones a reviewer pastes into a comment.

import { realpath } from "node:fs/promises";
import {
  dirname,
  extname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";
import {
  binaryResponse,
  jsonResponse,
  refusal,
} from "./review-route-context.js";
import type {
  ReviewRouteContext,
  ReviewRouteRequest,
  ReviewRouteResponse,
} from "./review-route-context.js";
import {
  readBoundedRegularFile,
  regularFileIdentity,
} from "./bounded-regular-file.js";
import { publishReviewImage, readReviewImage } from "./store.js";
import {
  isReviewImageId,
  MAX_IMAGE_BYTES,
  REVIEW_IMAGE_ROUTE,
} from "./shared/review-image.js";

// The picture file types a plan may point at, and the type each is served as.
// The list is closed: a request for anything else is not a picture request,
// so the review runtime never becomes a general file server for the directory
// that holds the plan.
const PLAN_PICTURE_TYPES: ReadonlyMap<string, string> = new Map([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".gif", "image/gif"],
  [".avif", "image/avif"],
  [".svg", "image/svg+xml"],
]);

const PICTURE_UNAVAILABLE = refusal({
  status: 404,
  reason: "Plan picture unavailable",
});

// Containment is checked twice against matching roots: once on the
// requested path, and once on the real path, because a link inside the
// directory could otherwise point anywhere. Comparing a real path with a
// symbolic root would reject every ordinary file on a machine whose
// temporary or home directory is itself a link.
const isWithin = (root: string, path: string): boolean => {
  const step = relative(root, path);
  return step !== "" && !step.startsWith("..") && !isAbsolute(step);
};

// A picture an author or an agent saved beside the plan is plan content, so
// the reviewer must see it. The route therefore serves the plan's own
// directory instead of one generated file name: a photograph named by its
// subject is the ordinary case, and refusing it showed alternative words
// where the plan promised a picture.
//
// The route serves only a bounded regular picture file whose requested and
// real paths stay inside the plan's own directory. A dot-prefixed segment is
// never served, which keeps the review state under `.big-plan/` outside the
// reach of a document request.
export const planAssetResponse = async (
  context: ReviewRouteContext,
  { pathname }: { readonly pathname: string },
): Promise<ReviewRouteResponse | undefined> => {
  let requested: string;
  try {
    requested = decodeURIComponent(pathname);
  } catch {
    return undefined;
  }
  const contentType = PLAN_PICTURE_TYPES.get(extname(requested).toLowerCase());
  if (contentType === undefined || requested.includes("\0")) return undefined;
  const segments = requested.split("/").filter((segment) => segment !== "");
  if (segments.some((segment) => segment.startsWith("."))) {
    return PICTURE_UNAVAILABLE;
  }
  const planDirectory = dirname(context.resolvedPlanPath);
  const candidate = resolve(planDirectory, segments.join("/"));
  if (!isWithin(planDirectory, candidate)) {
    return PICTURE_UNAVAILABLE;
  }
  try {
    const [root, real] = await Promise.all([
      realpath(planDirectory),
      realpath(candidate),
    ]);
    const realStep = relative(root, real);
    const realContentType = PLAN_PICTURE_TYPES.get(extname(real).toLowerCase());
    if (
      !isWithin(root, real) ||
      realContentType === undefined ||
      realStep.split(sep).some((segment) => segment.startsWith("."))
    ) {
      return PICTURE_UNAVAILABLE;
    }
    const expectedIdentity = await regularFileIdentity({
      path: real,
      maxBytes: MAX_IMAGE_BYTES,
    });
    if (expectedIdentity === undefined) {
      return PICTURE_UNAVAILABLE;
    }
    const bytes = await readBoundedRegularFile({
      path: real,
      maxBytes: MAX_IMAGE_BYTES,
      expectedIdentity,
    });
    if (bytes === undefined) {
      return PICTURE_UNAVAILABLE;
    }
    return binaryResponse({
      status: 200,
      contentType: realContentType,
      body: bytes,
    });
  } catch {
    return PICTURE_UNAVAILABLE;
  }
};

// An uploaded picture is plan state, not session state: it is stored beside
// the plan under its content digest and served from that digest alone, like
// a materialized plan asset. That is what keeps a reference minted in one
// review readable in every later one, including after a restart that creates
// a new session.
export const reviewImageResponse = async (
  context: ReviewRouteContext,
  { pathname }: { readonly pathname: string },
): Promise<ReviewRouteResponse | undefined> => {
  if (!pathname.startsWith(REVIEW_IMAGE_ROUTE)) return undefined;
  const id = pathname.slice(REVIEW_IMAGE_ROUTE.length);
  if (!isReviewImageId(id)) {
    return refusal({ status: 404, reason: "Unknown review image" });
  }
  const image = await readReviewImage({ store: context.store, id });
  if (image === undefined) {
    return refusal({ status: 404, reason: "Image unavailable" });
  }
  return binaryResponse({
    status: 200,
    contentType: image.descriptor.mimeType,
    body: image.bytes,
  });
};

/** Stores one pasted picture and answers with the reference the comment uses. */
export const publishImage = async (
  context: ReviewRouteContext,
  { headers, binaryBody }: ReviewRouteRequest,
): Promise<ReviewRouteResponse> => {
  if (binaryBody === undefined || binaryBody.byteLength === 0) {
    return refusal({ status: 400, reason: "An image body is required" });
  }
  const altHeader = headers["x-big-plan-image-alt"];
  const alt =
    typeof altHeader === "string" && altHeader.trim() !== ""
      ? altHeader.trim().slice(0, 200)
      : "Screenshot";
  try {
    return jsonResponse({
      status: 200,
      value: await publishReviewImage({
        store: context.store,
        bytes: binaryBody,
        alt,
      }),
    });
  } catch (error: unknown) {
    return refusal({
      status: 400,
      reason: error instanceof Error ? error.message : "The image is invalid",
    });
  }
};
