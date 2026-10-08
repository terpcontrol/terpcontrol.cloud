/** A 2x2 PNG: small enough to store a dozen times, and not a JPEG, so a JPEG coming back proves the upload was converted. */
export const A_PICTURE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR42mP4z8DAAMIM/4EAAB/uBfvxq7p3AAAAAElFTkSuQmCC',
  'base64',
);

/** A one-pixel JPEG: enough for a picture to exist and be served, in the type a camera's stills are stored as. */
export const A_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
  'base64',
);
