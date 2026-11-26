/** "Biobizz Light Mix" for the asset id "biobizz-light-mix": the words of the id, each with its capital, and no slug. */
export const assetTitle = (assetId: string): string =>
  assetId
    .split(/[-_]+/)
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
