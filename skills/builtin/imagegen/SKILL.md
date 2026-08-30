---
name: Image Generation
description: Generate a new image or edit an existing image from a text prompt. Use for illustrations, photos, textures, mockups, visual variants, and reference-image transformations that should produce a bitmap artifact.
icon: https://static.asidehq.com/apps/builtin-skills/image-generation.jpg
autoInject:
  keywords: ["generate an image", "create an image", "make an image", "edit this image", "image generation", "imagegen"]
---
# Image Generation

Use `imagegen.generate({ prompt, inputImages? })` in the REPL. Generate directly unless a required reference image is missing.

Pass reference images as task file paths, data URLs, or `{ data, mimeType }` objects. The result contains full-resolution artifact paths and image data. Display every returned image so the user can preview it.

```js
const generated1 = await imagegen.generate({ prompt: 'A red circle on a plain white background' });
for (const image1 of generated1.images) display(image1.data);
console.log(generated1.images.map((image1) => image1.path));
```

For edits, describe the complete desired result and pass the source image:

```js
const edited1 = await imagegen.generate({
  prompt: 'Keep the composition and replace the daytime sky with a starry night sky',
  inputImages: ['/absolute/session/attachments/source.png'],
});
for (const image2 of edited1.images) display(image2.data);
console.log(edited1.images.map((image2) => image2.path));
```

Do not add provider-specific size, quality, or billing options. If generation fails, report the exact concise error and do not retry unless the error explicitly says retrying may help. Treat refusals and policy errors as final; do not bypass them with manual compositing. Point the user to Settings > AI only when the error indicates provider setup is required.
