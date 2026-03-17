/**
 * Utility to compute _preview labels for reusable components.
 * Used by lifecycle hooks to auto-populate _preview field
 * so Strapi content-manager can display meaningful accordion headers.
 */

function getFirstTitle(titles) {
  if (!Array.isArray(titles) || titles.length === 0) return '';
  return titles[0]?.content || '';
}

function computeStyleBlockPreview(styleBlock, styleCode) {
  const title = getFirstTitle(styleBlock.titles);
  const subTitle = getFirstTitle(styleBlock.subTitles);

  let label = '';
  if (title && subTitle) {
    label = `${title} - ${subTitle}`;
  } else if (title) {
    label = title;
  }

  if (styleCode && label) {
    return `[${styleCode}] ${label}`;
  }
  if (styleCode) return styleCode;
  if (label) return label;

  return styleBlock.layout || 'Style Block';
}

function computeBannerPreview(banner) {
  const parts = [];
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

async function resolveStyleCodes(styleIds, strapi, styleContentType) {
  const codeMap = new Map();
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

function extractStyleId(styleRef) {
  if (!styleRef) return null;
  if (typeof styleRef === 'number' || typeof styleRef === 'string') {
    return String(styleRef);
  }
  if (typeof styleRef === 'object' && styleRef !== null) {
    if (styleRef.id) return String(styleRef.id);
    if (styleRef.documentId) return String(styleRef.documentId);
    const items = styleRef.connect || styleRef.set;
    if (Array.isArray(items) && items.length > 0) {
      return String(items[0].id || items[0].documentId || '');
    }
  }
  return null;
}

/**
 * Traverse screens data and compute _preview for style-blocks and banners.
 */
export async function computePreviewLabels(data, strapi, styleContentType) {
  if (!data?.screens || !Array.isArray(data.screens)) return;

  const styleIds = new Set();
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

  const styleCodeMap = await resolveStyleCodes(styleIds, strapi, styleContentType);

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
            styleBlock._preview = computeStyleBlockPreview(styleBlock, styleCode);
          }
        }
      }
    }
  }
}
