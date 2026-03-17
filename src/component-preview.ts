/**
 * Utility to compute _preview labels for reusable components.
 * Used by lifecycle hooks to auto-populate _preview field
 * so Strapi content-manager can display meaningful accordion headers.
 */

interface LocalizedContent {
  content?: string;
  country?: unknown;
}

interface StyleBlock {
  _preview?: string;
  titles?: LocalizedContent[];
  subTitles?: LocalizedContent[];
  layout?: string;
  style?: unknown;
}

interface BannerBlock {
  _preview?: string;
  titles?: LocalizedContent[];
  action?: string;
  categoryCode?: string;
  tool?: string;
  style?: unknown;
}

interface CategoryBlock {
  code?: string;
  styles?: StyleBlock[];
}

interface Screen {
  title?: string;
  banners?: BannerBlock[];
  categories?: CategoryBlock[];
}

function getFirstTitle(titles?: LocalizedContent[]): string {
  if (!Array.isArray(titles) || titles.length === 0) return '';
  return titles[0]?.content || '';
}

function computeStyleBlockPreview(
  styleBlock: StyleBlock,
  styleCode?: string
): string {
  const title = getFirstTitle(styleBlock.titles);
  const subTitle = getFirstTitle(styleBlock.subTitles);

  // Format: "title - subTitle" or just "title"
  let label = '';
  if (title && subTitle) {
    label = `${title} - ${subTitle}`;
  } else if (title) {
    label = title;
  }

  // Prepend style code if available
  if (styleCode && label) {
    return `[${styleCode}] ${label}`;
  }
  if (styleCode) return styleCode;
  if (label) return label;

  return styleBlock.layout || 'Style Block';
}

function computeBannerPreview(banner: BannerBlock): string {
  const parts: string[] = [];
  if (banner.action) parts.push(`[${banner.action}]`);

  const title = getFirstTitle(banner.titles);
  if (title) {
    parts.push(title);
  } else if (banner.action === 'CATEGORY' && banner.categoryCode) {
    parts.push(banner.categoryCode);
  } else if (banner.action === 'TOOL' && banner.tool) {
    parts.push(banner.tool);
  }
  return parts.join(' ') || 'Banner';
}

/**
 * Resolves style codes from relation IDs in batch.
 * Handles both numeric IDs and documentId strings.
 */
async function resolveStyleCodes(
  styleIds: Set<string>,
  strapi: any,
  styleContentType: string
): Promise<Map<string, string>> {
  const codeMap = new Map<string, string>();
  if (styleIds.size === 0) return codeMap;

  try {
    const numericIds = [...styleIds].filter((id) => !isNaN(Number(id)));
    const documentIds = [...styleIds].filter((id) => isNaN(Number(id)));

    if (numericIds.length > 0) {
      const styles = await strapi.db.query(styleContentType).findMany({
        where: { id: { $in: numericIds.map(Number) } },
        select: ['id', 'code'],
      });
      for (const s of styles) {
        codeMap.set(String(s.id), s.code);
      }
    }

    if (documentIds.length > 0) {
      const styles = await strapi.db.query(styleContentType).findMany({
        where: { documentId: { $in: documentIds } },
        select: ['documentId', 'code'],
      });
      for (const s of styles) {
        codeMap.set(s.documentId, s.code);
      }
    }
  } catch {
    // Silently fail - previews will work without style codes
  }

  return codeMap;
}

function extractStyleId(styleRef: unknown): string | null {
  if (!styleRef) return null;
  if (typeof styleRef === 'number' || typeof styleRef === 'string') {
    return String(styleRef);
  }
  if (typeof styleRef === 'object' && styleRef !== null) {
    const obj = styleRef as Record<string, unknown>;
    if (obj.id) return String(obj.id);
    if (obj.documentId) return String(obj.documentId);
    // Handle connect format: { connect: [{ id: 1 }] } or { set: [...] }
    const items = (obj.connect || obj.set) as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(items) && items.length > 0) {
      return String(items[0].id || items[0].documentId || '');
    }
  }
  return null;
}

/**
 * Traverse screens data and compute _preview for style-blocks and banners.
 */
export async function computePreviewLabels(
  data: { screens?: Screen[] },
  strapi: any,
  styleContentType: string
): Promise<void> {
  if (!data?.screens || !Array.isArray(data.screens)) return;

  // Collect all style relation IDs
  const styleIds = new Set<string>();
  for (const screen of data.screens) {
    if (screen?.banners) {
      for (const banner of screen.banners) {
        const id = extractStyleId(banner?.style);
        if (id) styleIds.add(id);
      }
    }
    if (screen?.categories) {
      for (const category of screen.categories) {
        if (category?.styles) {
          for (const styleBlock of category.styles) {
            const id = extractStyleId(styleBlock?.style);
            if (id) styleIds.add(id);
          }
        }
      }
    }
  }

  // Batch resolve style codes
  const styleCodeMap = await resolveStyleCodes(
    styleIds,
    strapi,
    styleContentType
  );

  // Compute preview labels
  for (const screen of data.screens) {
    if (screen?.banners) {
      for (const banner of screen.banners) {
        banner._preview = computeBannerPreview(banner);
      }
    }
    if (screen?.categories) {
      for (const category of screen.categories) {
        if (category?.styles) {
          for (const styleBlock of category.styles) {
            const id = extractStyleId(styleBlock.style);
            const styleCode = id ? styleCodeMap.get(id) : undefined;
            styleBlock._preview = computeStyleBlockPreview(
              styleBlock,
              styleCode
            );
          }
        }
      }
    }
  }
}
