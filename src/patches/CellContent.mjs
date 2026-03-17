import { jsx } from 'react/jsx-runtime';
import { Typography, Tooltip } from '@strapi/design-system';
import isEmpty from 'lodash/isEmpty';
import { CellValue } from './CellValue.mjs';
import { RepeatableComponent, SingleComponent } from './Components.mjs';
import { MediaSingle, MediaMultiple } from './Media.mjs';
import { RelationSingle, RelationMultiple } from './Relations.mjs';

const _COMPONENT_LABEL_KEYS = ['_preview','name','title','defaultName','code','content','label','displayName','slug','role','action','placement','useCase'];

const _extractComponentLabel = (obj, mainField)=>{
    if (!obj || typeof obj !== 'object') return '';
    // Try mainField first
    if (mainField && typeof obj[mainField.name] === 'string' && obj[mainField.name]) {
        return obj[mainField.name];
    }
    // Try priority fields
    for (const k of _COMPONENT_LABEL_KEYS) {
        if (typeof obj[k] === 'string' && obj[k]) return obj[k];
    }
    // Fallback: first short string value (skip id, documentId, __component)
    const _skip = new Set(['id','documentId','__component','createdAt','updatedAt','publishedAt','locale']);
    for (const [key, val] of Object.entries(obj)) {
        if (_skip.has(key)) continue;
        if (typeof val === 'string' && val && val.length < 100) return val;
    }
    return '';
};

const CellContent = ({ content, mainField, attribute, rowId, name })=>{
    if (!hasContent(content, mainField, attribute)) {
        return /*#__PURE__*/ jsx(Typography, {
            textColor: "neutral800",
            paddingLeft: attribute.type === ('relation') ? '1.6rem' : 0,
            paddingRight: attribute.type === ('relation') ? '1.6rem' : 0,
            children: "-"
        });
    }
    switch(attribute.type){
        case 'media':
            if (!attribute.multiple) {
                return /*#__PURE__*/ jsx(MediaSingle, {
                    ...content
                });
            }
            return /*#__PURE__*/ jsx(MediaMultiple, {
                content: content
            });
        case 'relation':
            {
                if (isSingleRelation(attribute.relation)) {
                    return /*#__PURE__*/ jsx(RelationSingle, {
                        mainField: mainField,
                        content: content
                    });
                }
                return /*#__PURE__*/ jsx(RelationMultiple, {
                    rowId: rowId,
                    mainField: mainField,
                    content: content,
                    name: name
                });
            }
        case 'component':
            // Already flattened to string by server-side
            if (typeof content === 'string') {
                return /*#__PURE__*/ jsx(Tooltip, {
                    label: content,
                    children: /*#__PURE__*/ jsx(Typography, {
                        maxWidth: "30rem",
                        ellipsis: true,
                        textColor: "neutral800",
                        children: content
                    })
                });
            }
            // Repeatable component: extract meaningful label from first item
            if (attribute.repeatable && Array.isArray(content)) {
                const _firstLabel = content.length > 0 ? _extractComponentLabel(content[0], mainField) : '';
                if (_firstLabel) {
                    const _display = content.length > 1 ? _firstLabel + ' (+' + (content.length - 1) + ')' : _firstLabel;
                    return /*#__PURE__*/ jsx(Tooltip, {
                        label: _display,
                        children: /*#__PURE__*/ jsx(Typography, {
                            maxWidth: "30rem",
                            ellipsis: true,
                            textColor: "neutral800",
                            children: _display
                        })
                    });
                }
                // Fallback to original RepeatableComponent
                return /*#__PURE__*/ jsx(RepeatableComponent, {
                    mainField: mainField,
                    content: content
                });
            }
            // Single component: extract meaningful label
            if (content && typeof content === 'object' && !Array.isArray(content)) {
                const _singleLabel = _extractComponentLabel(content, mainField);
                if (_singleLabel) {
                    return /*#__PURE__*/ jsx(Tooltip, {
                        label: _singleLabel,
                        children: /*#__PURE__*/ jsx(Typography, {
                            maxWidth: "30rem",
                            ellipsis: true,
                            textColor: "neutral800",
                            children: _singleLabel
                        })
                    });
                }
            }
            if (attribute.repeatable) {
                return /*#__PURE__*/ jsx(RepeatableComponent, {
                    mainField: mainField,
                    content: content
                });
            }
            return /*#__PURE__*/ jsx(SingleComponent, {
                mainField: mainField,
                content: content
            });
        case 'string':
            return /*#__PURE__*/ jsx(Tooltip, {
                label: content,
                children: /*#__PURE__*/ jsx(Typography, {
                    maxWidth: "30rem",
                    ellipsis: true,
                    textColor: "neutral800",
                    children: /*#__PURE__*/ jsx(CellValue, {
                        type: attribute.type,
                        value: content
                    })
                })
            });
        default:
            return /*#__PURE__*/ jsx(Typography, {
                maxWidth: "30rem",
                ellipsis: true,
                textColor: "neutral800",
                children: /*#__PURE__*/ jsx(CellValue, {
                    type: attribute.type,
                    value: content
                })
            });
    }
};
const hasContent = (content, mainField, attribute)=>{
    if (attribute.type === 'component') {
        if (typeof content === 'string') return content.length > 0;
        if (attribute.repeatable || !mainField) {
            // Arrays: check length; Objects (single component without mainField): check non-empty
            if (Array.isArray(content)) return content.length > 0;
            if (content && typeof content === 'object') return !isEmpty(content);
            return content?.length > 0;
        }
        const value = content?.[mainField.name];
        // relations, media ... show the id as fallback
        if (mainField.name === 'id' && ![
            undefined,
            null
        ].includes(value)) {
            return true;
        }
        return !isEmpty(value);
    }
    if (attribute.type === 'relation') {
        if (isSingleRelation(attribute.relation)) {
            return !isEmpty(content);
        }
        if (Array.isArray(content)) {
            return content.length > 0;
        }
        return content?.count > 0;
    }
    /*
      Biginteger fields need to be treated as strings, as `isNumber`
      doesn't deal with them.
  */ if ([
        'integer',
        'decimal',
        'float',
        'number'
    ].includes(attribute.type)) {
        return typeof content === 'number';
    }
    if (attribute.type === 'boolean') {
        return content !== null;
    }
    return !isEmpty(content);
};
const isSingleRelation = (type)=>[
        'oneToOne',
        'manyToOne',
        'oneToOneMorph'
    ].includes(type);

export { CellContent };
//# sourceMappingURL=CellContent.mjs.map
