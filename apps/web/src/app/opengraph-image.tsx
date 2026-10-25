import { renderSocialImage, socialImageAlt, socialImageSize } from "./_seo/social-image";

export const alt = socialImageAlt;
export const size = socialImageSize;
export const contentType = "image/png";

export default function Image() {
  return renderSocialImage();
}
