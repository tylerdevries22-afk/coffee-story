declare module '@tenant-bundle/config/*' {
  const value: unknown;
  export default value;
}

declare module '@tenant-bundle/generated/menu-media' {
  export const TENANT_MENU_MEDIA: Readonly<Record<string, number>>;
}

declare module '@tenant-bundle/generated/product-media' {
  export const BUNDLED_CUTOUTS: Readonly<Record<string, number>>;
}

declare module '@tenant-bundle/artwork/*' {
  const source: number;
  export default source;
}
