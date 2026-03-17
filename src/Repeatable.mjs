import { jsx, jsxs, Fragment } from 'react/jsx-runtime';
import * as React from 'react';
import { useNotification, useField, useForm, createRulesEngine, useIsDesktop, useFetchClient } from '@strapi/admin/strapi-admin';
import { Accordion, TextButton, Box, VisuallyHidden, useComposedRefs, IconButton, Flex, Searchbar, Modal, SingleSelect, SingleSelectOption, Button, Loader, Typography, Field } from '@strapi/design-system';
import { Search } from '@strapi/icons';
import { Plus, Trash, Drag, ArrowUp, ArrowDown, Duplicate } from '@strapi/icons';
import { getEmptyImage } from 'react-dnd-html5-backend';
import { useIntl } from 'react-intl';
import { useLocation } from 'react-router-dom';
import { styled } from 'styled-components';
import { ItemTypes } from '@strapi/content-manager/dist/admin/constants/dragAndDrop.mjs';
import { useDocumentContext } from '@strapi/content-manager/dist/admin/hooks/useDocumentContext.mjs';
import { useDragAndDrop } from '@strapi/content-manager/dist/admin/hooks/useDragAndDrop.mjs';
import { usePrev } from '@strapi/content-manager/dist/admin/hooks/usePrev.mjs';
import { getIn } from '@strapi/content-manager/dist/admin/utils/objects.mjs';
import { getTranslation } from '@strapi/content-manager/dist/admin/utils/translations.mjs';
import { transformDocument } from '@strapi/content-manager/dist/admin/pages/EditView/utils/data.mjs';
import { createDefaultForm } from '@strapi/content-manager/dist/admin/pages/EditView/utils/forms.mjs';
import { ResponsiveGridRoot, ResponsiveGridItem } from '@strapi/content-manager/dist/admin/pages/EditView/components/FormLayout.mjs';
import { useComponent, ComponentProvider } from '@strapi/content-manager/dist/admin/pages/EditView/components/FormInputs/ComponentContext.mjs';
import { Initializer } from '@strapi/content-manager/dist/admin/pages/EditView/components/FormInputs/Component/Initializer.mjs';

const getItemDisplayLabel = (itemData, mainField)=>{
    if (!itemData || typeof itemData !== 'object') return '';
    const directVal = itemData[mainField?.name];
    if (directVal != null && directVal !== '' && typeof directVal !== 'object') return String(directVal);
    if (itemData._preview) return String(itemData._preview);
    const titlesArr = itemData.titles;
    const subTitlesArr = itemData.subTitles;
    const title = Array.isArray(titlesArr) && titlesArr.length > 0 ? titlesArr[0]?.content : null;
    const subTitle = Array.isArray(subTitlesArr) && subTitlesArr.length > 0 ? subTitlesArr[0]?.content : null;
    if (title && subTitle) return title + ' - ' + subTitle;
    if (title) return title;
    if (subTitle) return subTitle;
    if (typeof itemData.code === 'string' && itemData.code) return itemData.code;
    if (typeof itemData.name === 'string' && itemData.name) return itemData.name;
    if (typeof itemData.title === 'string' && itemData.title) return itemData.title;
    if (typeof itemData.content === 'string' && itemData.content) return itemData.content;
    if (typeof itemData.layout === 'string' && itemData.layout) return itemData.layout;
    if (typeof itemData.action === 'string' && itemData.action) return itemData.action;
    if (typeof itemData.role === 'string' && itemData.role) return itemData.role;
    return '';
};
const deepCloneComponentData = (data)=>{
    if (data === null || data === undefined || typeof data !== 'object') return data;
    if (Array.isArray(data)) return data.map((item)=>deepCloneComponentData(item));
    const clone = {};
    for (const [key, val] of Object.entries(data)) {
        if (key === '__temp_key__') continue;
        if (key === 'id' && !data.documentId) continue;
        clone[key] = deepCloneComponentData(val);
    }
    return clone;
};

// ─── Helpers ────────────────────────────────────────────────────────

// Extract label from any object for display in selects
const extractLabel = (item, index)=>{
    if (!item || typeof item !== 'object') return `Item ${index + 1}`;
    if (item._preview) return String(item._preview);
    const titlesArr = item.titles;
    const subTitlesArr = item.subTitles;
    const t = Array.isArray(titlesArr) && titlesArr.length > 0 ? titlesArr[0]?.content : null;
    const s = Array.isArray(subTitlesArr) && subTitlesArr.length > 0 ? subTitlesArr[0]?.content : null;
    if (t && s) return `${t} - ${s}`;
    if (t) return t;
    if (s) return s;
    for (const k of ['code','name','title','displayName','bundleId','slug','layout','action']) {
        if (typeof item[k] === 'string' && item[k]) return item[k];
    }
    return `Item ${index + 1}`;
};

// Parse component field name into path segments
// e.g. "screens.0.categories.1.styles" → ["screens","categories","styles"]
const parseFieldSegments = (fieldName)=>{
    const parts = fieldName.split('.');
    return parts.filter(p => isNaN(Number(p)));
};

// ─── Cross-Record Duplicate Modal ───────────────────────────────────
const DuplicateTargetModal = ({ isOpen, onClose, onConfirmSameRecord, componentData, model, currentDocumentId, fieldName })=>{
    const { formatMessage } = useIntl();
    const { toggleNotification } = useNotification();
    const { get, put } = useFetchClient();

    // Path segments: e.g. ["screens","categories","styles"]
    const fieldSegments = React.useMemo(()=> fieldName ? parseFieldSegments(fieldName) : [], [fieldName]);
    // The intermediate segments (not including the last one which is the target array)
    // e.g. ["screens","categories"] — these are levels the user must pick an item from
    const intermediateSegments = fieldSegments.slice(0, -1);
    // The final segment is the array we append to
    const targetArrayField = fieldSegments[fieldSegments.length - 1];

    const [records, setRecords] = React.useState([]);
    const [loading, setLoading] = React.useState(false);
    const [saving, setSaving] = React.useState(false);
    const [selectedDocumentId, setSelectedDocumentId] = React.useState(null);
    const [targetRecord, setTargetRecord] = React.useState(null);
    const [targetLoading, setTargetLoading] = React.useState(false);

    // Cascading selections: one index per intermediate segment
    // e.g. [0, 2] means screens[0].categories[2]
    const [pathSelections, setPathSelections] = React.useState([]);

    // Reset state when modal opens
    React.useEffect(()=>{
        if (!isOpen || !model) return;
        setSelectedDocumentId(currentDocumentId);
        setTargetRecord(null);
        setPathSelections([]);
        fetchRecords();
    }, [isOpen, model]);

    const fetchRecords = async ()=>{
        setLoading(true);
        try {
            const params = { page: 1, pageSize: 50, sort: 'updatedAt:DESC' };
            const { data } = await get(`/content-manager/collection-types/${model}`, { params });
            setRecords(data?.results || data?.data || []);
        } catch (err) {
            console.error('[DuplicateTargetModal] fetch records error:', err);
            setRecords([]);
        } finally {
            setLoading(false);
        }
    };

    // Fetch full target record when selection changes
    const fetchTargetRecord = async (docId)=>{
        if (!docId || docId === currentDocumentId) {
            setTargetRecord(null);
            setPathSelections([]);
            return;
        }
        setTargetLoading(true);
        setPathSelections([]);
        try {
            const { data } = await get(
                `/content-manager/collection-types/${model}/${docId}`,
                { params: { populate: { populate: '*' } } }
            );
            const record = data?.data || data;
            console.log('[DuplicateTargetModal] fetched target record:', record);
            setTargetRecord(record);
        } catch (err) {
            console.error('[DuplicateTargetModal] fetch target error:', err);
            setTargetRecord(null);
            toggleNotification({ type: 'warning', message: 'Failed to fetch target record' });
        } finally {
            setTargetLoading(false);
        }
    };

    const handleRecordChange = (docId)=>{
        setSelectedDocumentId(docId);
        fetchTargetRecord(docId);
    };

    // Get the items available at a given nesting level
    const getItemsAtLevel = (level)=>{
        if (!targetRecord) return [];
        let current = targetRecord;
        for (let i = 0; i < level; i++) {
            const seg = intermediateSegments[i];
            const arr = current[seg];
            if (!Array.isArray(arr)) return [];
            const selectedIdx = pathSelections[i];
            if (selectedIdx === undefined || selectedIdx === null) return [];
            current = arr[selectedIdx];
            if (!current) return [];
        }
        const seg = intermediateSegments[level];
        const arr = current[seg];
        return Array.isArray(arr) ? arr : [];
    };

    // Get the final target container where we'll append the component
    const getTargetContainer = ()=>{
        if (!targetRecord) return null;
        let current = targetRecord;
        for (let i = 0; i < intermediateSegments.length; i++) {
            const seg = intermediateSegments[i];
            const arr = current[seg];
            if (!Array.isArray(arr)) return null;
            const selectedIdx = pathSelections[i];
            if (selectedIdx === undefined || selectedIdx === null) return null;
            current = arr[selectedIdx];
            if (!current) return null;
        }
        return current;
    };

    const isCrossRecord = selectedDocumentId && selectedDocumentId !== currentDocumentId;
    const allLevelsSelected = !isCrossRecord || (pathSelections.length === intermediateSegments.length && pathSelections.every(v => v !== null && v !== undefined));

    const handleConfirm = async ()=>{
        if (!selectedDocumentId) return;

        // Same record — use local clone
        if (!isCrossRecord) {
            onConfirmSameRecord();
            onClose();
            return;
        }

        if (!allLevelsSelected) return;

        setSaving(true);
        try {
            // Re-fetch target with deep populate to get full data for PUT
            const { data: freshData } = await get(
                `/content-manager/collection-types/${model}/${selectedDocumentId}`,
                { params: { populate: { populate: '*' } } }
            );
            const fresh = freshData?.data || freshData;
            if (!fresh) throw new Error('Target record not found');

            // Navigate to target container using path selections
            let container = fresh;
            for (let i = 0; i < intermediateSegments.length; i++) {
                const seg = intermediateSegments[i];
                container = container[seg][pathSelections[i]];
            }

            // Clone and append
            const clonedData = deepCloneComponentData(componentData);
            delete clonedData.documentId;
            if (!Array.isArray(container[targetArrayField])) {
                container[targetArrayField] = [];
            }
            container[targetArrayField].push(clonedData);

            // Clean system fields for PUT
            const body = { ...fresh };
            delete body.id;
            delete body.createdAt;
            delete body.updatedAt;
            delete body.publishedAt;
            delete body.createdBy;
            delete body.updatedBy;
            delete body.locale;
            delete body.localizations;
            delete body.status;

            await put(
                `/content-manager/collection-types/${model}/${selectedDocumentId}`,
                body
            );

            toggleNotification({
                type: 'success',
                message: 'Component duplicated to target record successfully!'
            });
            onClose();
        } catch (err) {
            console.error('[DuplicateTargetModal] save error:', err);
            toggleNotification({
                type: 'warning',
                message: 'Failed to duplicate: ' + (err?.message || 'Unknown error')
            });
        } finally {
            setSaving(false);
        }
    };

    if (!isOpen) return null;

    const getRecordLabel = (record)=>{
        const candidates = [record.name, record.title, record.code, record.slug, record.displayName, record.bundleId];
        for (const val of candidates) {
            if (typeof val === 'string' && val) return val;
        }
        return `#${record.documentId?.slice(0, 8) || record.id}`;
    };

    return /*#__PURE__*/ jsx(Modal.Root, {
        open: isOpen,
        onOpenChange: (open)=>{ if (!open) onClose(); },
        children: /*#__PURE__*/ jsxs(Modal.Content, {
            children: [
                /*#__PURE__*/ jsx(Modal.Header, {
                    children: /*#__PURE__*/ jsx(Modal.Title, {
                        children: 'Duplicate Component'
                    })
                }),
                /*#__PURE__*/ jsxs(Modal.Body, {
                    children: [
                        /*#__PURE__*/ jsx(Box, {
                            paddingBottom: 4,
                            children: /*#__PURE__*/ jsx(Typography, {
                                variant: "omega",
                                textColor: "neutral600",
                                children: isCrossRecord && intermediateSegments.length > 0
                                    ? `Select target record, then choose exactly where to place the duplicated ${targetArrayField || 'component'}.`
                                    : 'Select a target record. Choose current record to duplicate in place.'
                            })
                        }),
                        // Step 1: Record selection
                        /*#__PURE__*/ jsxs(Field.Root, {
                            children: [
                                /*#__PURE__*/ jsx(Field.Label, { children: 'Target Record' }),
                                loading
                                    ? /*#__PURE__*/ jsx(Loader, { small: true })
                                    : /*#__PURE__*/ jsx(SingleSelect, {
                                        value: selectedDocumentId,
                                        onChange: handleRecordChange,
                                        placeholder: 'Select a record...',
                                        children: records.map((record)=>{
                                            const label = getRecordLabel(record);
                                            const isCurrent = record.documentId === currentDocumentId;
                                            return /*#__PURE__*/ jsx(SingleSelectOption, {
                                                value: record.documentId,
                                                children: isCurrent ? `${label} (current)` : label
                                            }, record.documentId);
                                        })
                                    })
                            ]
                        }),

                        // Step 2+: Cascading path selections (only for cross-record)
                        isCrossRecord && targetLoading && /*#__PURE__*/ jsx(Box, {
                            paddingTop: 4,
                            children: /*#__PURE__*/ jsxs(Flex, {
                                alignItems: "center",
                                gap: 2,
                                children: [
                                    /*#__PURE__*/ jsx(Loader, { small: true }),
                                    /*#__PURE__*/ jsx(Typography, { variant: "pi", children: 'Loading target record...' })
                                ]
                            })
                        }),

                        isCrossRecord && targetRecord && intermediateSegments.map((segmentName, levelIndex)=>{
                            // Only show this level if all previous levels are selected
                            const allPreviousSelected = pathSelections.slice(0, levelIndex).every(v => v !== null && v !== undefined);
                            if (levelIndex > 0 && !allPreviousSelected) return null;

                            const items = getItemsAtLevel(levelIndex);
                            if (items.length === 0 && levelIndex > 0) return null;

                            const selectedValue = pathSelections[levelIndex];
                            const capitalizedName = segmentName.charAt(0).toUpperCase() + segmentName.slice(1);

                            return /*#__PURE__*/ jsxs(Field.Root, {
                                children: [
                                    /*#__PURE__*/ jsx(Box, { paddingTop: 3, children:
                                        /*#__PURE__*/ jsx(Field.Label, {
                                            children: `Select ${capitalizedName}`
                                        })
                                    }),
                                    items.length === 0
                                        ? /*#__PURE__*/ jsx(Typography, {
                                            variant: "pi",
                                            textColor: "neutral500",
                                            children: `No ${segmentName} found in target record.`
                                        })
                                        : /*#__PURE__*/ jsx(SingleSelect, {
                                            value: selectedValue !== null && selectedValue !== undefined ? String(selectedValue) : undefined,
                                            onChange: (val)=>{
                                                const idx = Number(val);
                                                setPathSelections(prev => {
                                                    const updated = [...prev.slice(0, levelIndex), idx];
                                                    // Clear deeper selections
                                                    return updated;
                                                });
                                            },
                                            placeholder: `Choose a ${segmentName.replace(/s$/, '')}...`,
                                            children: items.map((item, idx)=> /*#__PURE__*/ jsx(SingleSelectOption, {
                                                value: String(idx),
                                                children: extractLabel(item, idx)
                                            }, idx))
                                        })
                                ]
                            }, segmentName);
                        }),

                        // Show target preview
                        isCrossRecord && allLevelsSelected && targetRecord && /*#__PURE__*/ jsx(Box, {
                            paddingTop: 3,
                            background: "success100",
                            padding: 3,
                            hasRadius: true,
                            children: /*#__PURE__*/ jsx(Typography, {
                                variant: "pi",
                                textColor: "success700",
                                children: `Will append to: ${fieldSegments.map((seg, i) => {
                                    if (i < intermediateSegments.length) {
                                        const selIdx = pathSelections[i];
                                        const items = getItemsAtLevel(i);
                                        const label = items[selIdx] ? extractLabel(items[selIdx], selIdx) : selIdx;
                                        return `${seg}[${label}]`;
                                    }
                                    return seg;
                                }).join(' → ')}`
                            })
                        }),

                        // Warning for cross-record
                        isCrossRecord && /*#__PURE__*/ jsx(Box, {
                            paddingTop: 2,
                            children: /*#__PURE__*/ jsx(Typography, {
                                variant: "pi",
                                textColor: "warning600",
                                children: 'The target record will be saved automatically after duplication.'
                            })
                        })
                    ]
                }),
                /*#__PURE__*/ jsxs(Modal.Footer, {
                    children: [
                        /*#__PURE__*/ jsx(Modal.Close, {
                            children: /*#__PURE__*/ jsx(Button, {
                                variant: "tertiary",
                                children: 'Cancel'
                            })
                        }),
                        /*#__PURE__*/ jsx(Button, {
                            onClick: handleConfirm,
                            disabled: !selectedDocumentId || saving || (isCrossRecord && !allLevelsSelected),
                            loading: saving,
                            children: isCrossRecord ? 'Duplicate to Target' : 'Duplicate Here'
                        })
                    ]
                })
            ]
        })
    });
};

// ─── End Cross-Record Duplicate Modal ───────────────────────────────

const RepeatableComponent = ({ attribute, disabled, name, mainField, children, layout })=>{
    const { toggleNotification } = useNotification();
    const { formatMessage } = useIntl();
    const { search: searchString } = useLocation();
    const search = React.useMemo(()=>new URLSearchParams(searchString), [
        searchString
    ]);
    const { currentDocument, currentDocumentMeta } = useDocumentContext('RepeatableComponent');
    const components = currentDocument.components;
    const { value = [], error, rawError } = useField(name);
    const addFieldRow = useForm('RepeatableComponent', (state)=>state.addFieldRow);
    const moveFieldRow = useForm('RepeatableComponent', (state)=>state.moveFieldRow);
    const removeFieldRow = useForm('RepeatableComponent', (state)=>state.removeFieldRow);
    const { max = Infinity } = attribute;
    const [collapseToOpen, setCollapseToOpen] = React.useState('');
    const [liveText, setLiveText] = React.useState('');
    const rulesEngine = createRulesEngine();

    // Cross-record duplicate modal state
    const [duplicateModalOpen, setDuplicateModalOpen] = React.useState(false);
    const [duplicateSourceIndex, setDuplicateSourceIndex] = React.useState(null);

    React.useEffect(()=>{
        const hasNestedErrors = rawError && Array.isArray(rawError) && rawError.length > 0;
        const hasNestedValue = value && Array.isArray(value) && value.length > 0;
        if (hasNestedErrors && hasNestedValue) {
            const errorOpenItems = rawError.map((_, idx)=>{
                return value[idx] ? value[idx].__temp_key__ : null;
            }).filter((value)=>!!value);
            if (errorOpenItems && errorOpenItems.length > 0) {
                setCollapseToOpen((collapseToOpen)=>{
                    if (!errorOpenItems.includes(collapseToOpen)) {
                        return errorOpenItems[0];
                    }
                    return collapseToOpen;
                });
            }
        }
    }, [
        rawError,
        value
    ]);
    const componentTmpKeyWithFocussedField = React.useMemo(()=>{
        if (search.has('field')) {
            const fieldParam = search.get('field');
            if (!fieldParam) {
                return undefined;
            }
            const [, path] = fieldParam.split(`${name}.`);
            if (getIn(value, path, undefined) !== undefined) {
                const [subpath] = path.split('.');
                return getIn(value, subpath, undefined)?.__temp_key__;
            }
        }
        return undefined;
    }, [
        search,
        name,
        value
    ]);
    const prevValue = usePrev(value);
    React.useEffect(()=>{
        if (prevValue && prevValue.length < value.length) {
            setCollapseToOpen(value[value.length - 1].__temp_key__);
        }
    }, [
        value,
        prevValue
    ]);
    React.useEffect(()=>{
        if (typeof componentTmpKeyWithFocussedField === 'string') {
            setCollapseToOpen(componentTmpKeyWithFocussedField);
        }
    }, [
        componentTmpKeyWithFocussedField
    ]);
    const toggleCollapses = ()=>{
        setCollapseToOpen('');
    };
    const handleClick = ()=>{
        if (value.length < max) {
            const schema = components[attribute.component];
            const form = createDefaultForm(schema, components);
            const data = transformDocument(schema, components)(form);
            addFieldRow(name, data);
        } else if (value.length >= max) {
            toggleNotification({
                type: 'info',
                message: formatMessage({
                    id: getTranslation('components.notification.info.maximum-requirement')
                })
            });
        }
    };
    const handleCloneComponentLocal = (index)=>{
        if (value.length >= max) {
            toggleNotification({
                type: 'info',
                message: formatMessage({
                    id: getTranslation('components.notification.info.maximum-requirement')
                })
            });
            return;
        }
        const sourceData = value[index];
        const clonedData = deepCloneComponentData(sourceData);
        addFieldRow(name, clonedData);
        if (value.length > 0) {
            setTimeout(()=>moveFieldRow(name, value.length, index + 1), 0);
        }
    };
    const handleCloneComponent = (index)=>{
        console.log('[cross-record-duplicate] name:', name, 'model:', currentDocumentMeta?.model, 'docId:', currentDocumentMeta?.documentId);
        if (currentDocumentMeta?.model && currentDocumentMeta?.documentId) {
            setDuplicateSourceIndex(index);
            setDuplicateModalOpen(true);
        } else {
            handleCloneComponentLocal(index);
        }
    };
    const handleMoveComponentField = (newIndex, currentIndex)=>{
        setLiveText(formatMessage({
            id: getTranslation('dnd.reorder'),
            defaultMessage: '{item}, moved. New position in list: {position}.'
        }, {
            item: `${name}.${currentIndex}`,
            position: getItemPos(newIndex)
        }));
        moveFieldRow(name, currentIndex, newIndex);
    };
    const handleValueChange = (key)=>{
        setCollapseToOpen(key);
    };
    const getItemPos = (index)=>`${index + 1} of ${value.length}`;
    const handleCancel = (index)=>{
        setLiveText(formatMessage({
            id: getTranslation('dnd.cancel-item'),
            defaultMessage: '{item}, dropped. Re-order cancelled.'
        }, {
            item: `${name}.${index}`
        }));
    };
    const handleGrabItem = (index)=>{
        setLiveText(formatMessage({
            id: getTranslation('dnd.grab-item'),
            defaultMessage: `{item}, grabbed. Current position in list: {position}. Press up and down arrow to change position, Spacebar to drop, Escape to cancel.`
        }, {
            item: `${name}.${index}`,
            position: getItemPos(index)
        }));
    };
    const handleDropItem = (index)=>{
        setLiveText(formatMessage({
            id: getTranslation('dnd.drop-item'),
            defaultMessage: `{item}, dropped. Final position in list: {position}.`
        }, {
            item: `${name}.${index}`,
            position: getItemPos(index)
        }));
    };
    const ariaDescriptionId = React.useId();
    const level = useComponent('RepeatableComponent', (state)=>state.level);
    const [searchFilter, setSearchFilter] = React.useState('');
    const formValues = useForm('RepeatableComponent', (state)=>state.values);
    const itemLabels = React.useMemo(()=>{
        return value.map((item, idx)=>{
            const basePath = name.split('.');
            basePath.push(String(idx));
            const itemData = getIn(formValues, basePath);
            const label = getItemDisplayLabel(itemData, mainField);
            return label || `Item ${idx + 1}`;
        });
    }, [value, formValues, name, mainField]);
    const filteredIndices = React.useMemo(()=>{
        if (!searchFilter.trim()) return null;
        const query = searchFilter.toLowerCase().trim();
        const indices = [];
        value.forEach((item, idx)=>{
            if (itemLabels[idx].toLowerCase().includes(query)) {
                indices.push(idx);
            }
        });
        return indices;
    }, [searchFilter, value, itemLabels]);
    if (value.length === 0) {
        return /*#__PURE__*/ jsx(Initializer, {
            disabled: disabled,
            name: name,
            onClick: handleClick
        });
    }
    return /*#__PURE__*/ jsxs(Box, {
        hasRadius: true,
        children: [
            /*#__PURE__*/ jsx(VisuallyHidden, {
                id: ariaDescriptionId,
                children: formatMessage({
                    id: getTranslation('dnd.instructions'),
                    defaultMessage: `Press spacebar to grab and re-order`
                })
            }),
            /*#__PURE__*/ jsx(VisuallyHidden, {
                "aria-live": "assertive",
                children: liveText
            }),
            value.length >= 3 && /*#__PURE__*/ jsx(Box, {
                paddingLeft: 3,
                paddingRight: 3,
                paddingTop: 2,
                paddingBottom: 2,
                children: /*#__PURE__*/ jsx(Searchbar, {
                    name: `${name}-search`,
                    placeholder: formatMessage({
                        id: 'component-preview.search',
                        defaultMessage: 'Filter items...'
                    }),
                    value: searchFilter,
                    onChange: (e)=>setSearchFilter(e.target.value),
                    onClear: ()=>setSearchFilter(''),
                    children: formatMessage({
                        id: 'component-preview.search.label',
                        defaultMessage: 'Filter'
                    })
                })
            }),
            filteredIndices !== null && /*#__PURE__*/ jsx(Box, {
                paddingLeft: 3,
                paddingRight: 3,
                paddingBottom: 1,
                children: /*#__PURE__*/ jsx("span", {
                    style: { fontSize: '1.2rem', color: '#a5a5ba' },
                    children: `${filteredIndices.length} / ${value.length} items`
                })
            }),
            /*#__PURE__*/ jsxs(AccordionRoot, {
                $error: error,
                value: collapseToOpen,
                onValueChange: handleValueChange,
                "aria-describedby": ariaDescriptionId,
                children: [
                    value.map(({ __temp_key__: key, id, ...currentComponentValues }, index)=>{
                        if (filteredIndices !== null && !filteredIndices.includes(index)) {
                            return null;
                        }
                        const nameWithIndex = `${name}.${index}`;
                        return /*#__PURE__*/ jsx(Box, {
                            id: `repeatable-item-${key}`,
                            children: /*#__PURE__*/ jsx(ComponentProvider, {
                            id: id,
                            uid: attribute.component,
                            level: level + 1,
                            type: "repeatable",
                            children: /*#__PURE__*/ jsx(Component, {
                                disabled: disabled,
                                name: nameWithIndex,
                                attribute: attribute,
                                index: index,
                                mainField: mainField,
                                onMoveItem: handleMoveComponentField,
                                onDeleteComponent: ()=>{
                                    removeFieldRow(name, index);
                                    toggleCollapses();
                                },
                                onCloneComponent: ()=>{
                                    handleCloneComponent(index);
                                },
                                toggleCollapses: toggleCollapses,
                                onCancel: handleCancel,
                                onDropItem: handleDropItem,
                                onGrabItem: handleGrabItem,
                                __temp_key__: key,
                                totalLength: value.length,
                                children: layout.map((row, index)=>{
                                    const visibleFields = row.filter(({ ...field })=>{
                                        const condition = field.attribute.conditions?.visible;
                                        if (condition) {
                                            return rulesEngine.evaluate(condition, currentComponentValues);
                                        }
                                        return true;
                                    });
                                    if (visibleFields.length === 0) {
                                        return null;
                                    }
                                    return /*#__PURE__*/ jsx(ResponsiveGridRoot, {
                                        gap: 4,
                                        children: visibleFields.map(({ size, ...field })=>{
                                            const completeFieldName = `${nameWithIndex}.${field.name}`;
                                            const translatedLabel = formatMessage({
                                                id: `content-manager.components.${attribute.component}.${field.name}`,
                                                defaultMessage: field.label
                                            });
                                            return /*#__PURE__*/ jsx(ResponsiveGridItem, {
                                                col: size,
                                                s: 12,
                                                xs: 12,
                                                direction: "column",
                                                alignItems: "stretch",
                                                children: children({
                                                    ...field,
                                                    label: translatedLabel,
                                                    name: completeFieldName,
                                                    document: currentDocument
                                                })
                                            }, completeFieldName);
                                        })
                                    }, index);
                                })
                            })
                        })
                        }, key);
                    }),
                    /*#__PURE__*/ jsx(TextButtonCustom, {
                        disabled: disabled,
                        onClick: handleClick,
                        startIcon: /*#__PURE__*/ jsx(Plus, {}),
                        children: formatMessage({
                            id: getTranslation('containers.EditView.add.new-entry'),
                            defaultMessage: 'Add an entry'
                        })
                    })
                ]
            }),
            /*#__PURE__*/ jsx(DuplicateTargetModal, {
                isOpen: duplicateModalOpen,
                onClose: ()=>{
                    setDuplicateModalOpen(false);
                    setDuplicateSourceIndex(null);
                },
                onConfirmSameRecord: ()=>{
                    if (duplicateSourceIndex !== null) {
                        handleCloneComponentLocal(duplicateSourceIndex);
                    }
                },
                componentData: duplicateSourceIndex !== null ? value[duplicateSourceIndex] : null,
                model: currentDocumentMeta?.model,
                currentDocumentId: currentDocumentMeta?.documentId,
                fieldName: name
            })
        ]
    });
};
const AccordionRoot = styled(Accordion.Root)`
  border: 1px solid
    ${({ theme, $error })=>$error ? theme.colors.danger600 : theme.colors.neutral200};
`;
const TextButtonCustom = styled(TextButton)`
  width: 100%;
  display: flex;
  justify-content: center;
  border-top: 1px solid ${({ theme })=>theme.colors.neutral200};
  padding-inline: ${(props)=>props.theme.spaces[6]};
  padding-block: ${(props)=>props.theme.spaces[3]};

  &:not([disabled]) {
    cursor: pointer;

    &:hover {
      background-color: ${(props)=>props.theme.colors.primary100};
    }
  }

  span {
    font-weight: 600;
    font-size: 1.4rem;
    line-height: 2.4rem;
  }

  @media (prefers-reduced-motion: no-preference) {
    transition: background-color 120ms ${(props)=>props.theme.motion.easings.easeOutQuad};
  }
`;
const Component = ({ disabled, index, name, mainField = {
    name: 'id',
    type: 'integer'
}, children, onDeleteComponent, onCloneComponent, toggleCollapses, __temp_key__, totalLength, onMoveItem, ...dragProps })=>{
    const { formatMessage } = useIntl();
    const isDesktop = useIsDesktop();
    const displayValue = useForm('RepeatableComponent', (state)=>{
        const basePath = name.split('.');
        const value = getIn(state.values, [...basePath, mainField.name]);
        if (value != null && value !== '' && typeof value !== 'object') return value;
        const componentData = getIn(state.values, basePath);
        if (componentData && typeof componentData === 'object') {
            console.debug('[component-preview]', { mainField: mainField.name, value, keys: Object.keys(componentData), titles: componentData.titles, subTitles: componentData.subTitles });
            if (componentData._preview) return componentData._preview;
            const titlesArr = componentData.titles;
            const subTitlesArr = componentData.subTitles;
            const title = Array.isArray(titlesArr) && titlesArr.length > 0 ? titlesArr[0]?.content : null;
            const subTitle = Array.isArray(subTitlesArr) && subTitlesArr.length > 0 ? subTitlesArr[0]?.content : null;
            if (title && subTitle) return title + ' - ' + subTitle;
            if (title) return title;
            if (subTitle) return subTitle;
            if (typeof componentData.code === 'string' && componentData.code) return componentData.code;
            if (typeof componentData.name === 'string' && componentData.name) return componentData.name;
            if (typeof componentData.title === 'string' && componentData.title) return componentData.title;
            if (typeof componentData.content === 'string' && componentData.content) return componentData.content;
            if (typeof componentData.layout === 'string' && componentData.layout) return componentData.layout;
            if (typeof componentData.action === 'string' && componentData.action) return componentData.action;
            if (typeof componentData.role === 'string' && componentData.role) return componentData.role;
        }
        return value;
    });
    const accordionRef = React.useRef(null);
    const componentKey = name.split('.').slice(0, -1).join('.');
    const [{ handlerId, isDragging, handleKeyDown }, boxRef, dropRef, dragRef, dragPreviewRef] = useDragAndDrop(!disabled, {
        type: `${ItemTypes.COMPONENT}_${componentKey}`,
        index,
        item: {
            index,
            displayedValue: displayValue
        },
        onStart () {
            toggleCollapses();
        },
        onMoveItem,
        ...dragProps
    });
    React.useEffect(()=>{
        dragPreviewRef(getEmptyImage(), {
            captureDraggingState: false
        });
    }, [
        dragPreviewRef,
        index
    ]);
    const composedAccordionRefs = useComposedRefs(accordionRef, dragRef);
    const composedBoxRefs = useComposedRefs(boxRef, dropRef);
    const handleMoveUp = React.useCallback((e)=>{
        e.stopPropagation();
        if (index > 0 && onMoveItem) {
            onMoveItem(index - 1, index);
        }
    }, [
        index,
        onMoveItem
    ]);
    const handleMoveDown = React.useCallback((e)=>{
        e.stopPropagation();
        if (index < totalLength - 1 && onMoveItem) {
            onMoveItem(index + 1, index);
        }
    }, [
        index,
        totalLength,
        onMoveItem
    ]);
    const canMoveUp = index > 0;
    const canMoveDown = index < totalLength - 1;
    return /*#__PURE__*/ jsx(Fragment, {
        children: isDragging ? /*#__PURE__*/ jsx(Preview, {}) : /*#__PURE__*/ jsxs(Accordion.Item, {
            ref: composedBoxRefs,
            value: __temp_key__,
            children: [
                /*#__PURE__*/ jsxs(Accordion.Header, {
                    children: [
                        /*#__PURE__*/ jsx(Accordion.Trigger, {
                            children: displayValue
                        }),
                        /*#__PURE__*/ jsxs(Accordion.Actions, {
                            children: [
                                /*#__PURE__*/ jsx(IconButton, {
                                    disabled: disabled,
                                    variant: "ghost",
                                    onClick: (e)=>{
                                        e.stopPropagation();
                                        onCloneComponent();
                                    },
                                    label: formatMessage({
                                        id: 'component-preview.clone',
                                        defaultMessage: 'Duplicate'
                                    }),
                                    children: /*#__PURE__*/ jsx(Duplicate, {})
                                }),
                                /*#__PURE__*/ jsx(IconButton, {
                                    disabled: disabled,
                                    variant: "ghost",
                                    onClick: onDeleteComponent,
                                    label: formatMessage({
                                        id: getTranslation('containers.Edit.delete'),
                                        defaultMessage: 'Delete'
                                    }),
                                    children: /*#__PURE__*/ jsx(Trash, {})
                                }),
                                isDesktop && /*#__PURE__*/ jsx(IconButton, {
                                    disabled: disabled,
                                    ref: composedAccordionRefs,
                                    variant: "ghost",
                                    onClick: (e)=>e.stopPropagation(),
                                    "data-handler-id": handlerId,
                                    label: formatMessage({
                                        id: getTranslation('components.DragHandle-label'),
                                        defaultMessage: 'Drag'
                                    }),
                                    onKeyDown: handleKeyDown,
                                    children: /*#__PURE__*/ jsx(Drag, {})
                                }),
                                !isDesktop && /*#__PURE__*/ jsxs(Fragment, {
                                    children: [
                                        canMoveUp && /*#__PURE__*/ jsx(IconButton, {
                                            disabled: disabled || !canMoveUp,
                                            variant: "ghost",
                                            onClick: handleMoveUp,
                                            label: formatMessage({
                                                id: getTranslation('components.DynamicZone.move-up'),
                                                defaultMessage: 'Move up'
                                            }),
                                            children: /*#__PURE__*/ jsx(ArrowUp, {})
                                        }),
                                        canMoveDown && /*#__PURE__*/ jsx(IconButton, {
                                            disabled: disabled || !canMoveDown,
                                            variant: "ghost",
                                            onClick: handleMoveDown,
                                            label: formatMessage({
                                                id: getTranslation('components.DynamicZone.move-down'),
                                                defaultMessage: 'Move down'
                                            }),
                                            children: /*#__PURE__*/ jsx(ArrowDown, {})
                                        })
                                    ]
                                })
                            ]
                        })
                    ]
                }),
                /*#__PURE__*/ jsx(Accordion.Content, {
                    children: /*#__PURE__*/ jsx(Flex, {
                        direction: "column",
                        alignItems: "stretch",
                        background: "neutral100",
                        padding: {
                            initial: 4,
                            medium: 6
                        },
                        gap: {
                            initial: 3,
                            medium: 4
                        },
                        children: children
                    })
                })
            ]
        })
    });
};
const Preview = ()=>{
    return /*#__PURE__*/ jsx(StyledSpan, {
        tag: "span",
        padding: 6,
        background: "primary100"
    });
};
const StyledSpan = styled(Box)`
  display: block;
  outline: 1px dashed ${({ theme })=>theme.colors.primary500};
  outline-offset: -1px;
`;

export { RepeatableComponent };
//# sourceMappingURL=Repeatable.mjs.map
