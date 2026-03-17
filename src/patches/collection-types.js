'use strict';

var fp = require('lodash/fp');
var strapiUtils = require('@strapi/utils');
var index = require('../utils/index.js');
var index$1 = require('./validation/index.js');
var clone = require('./utils/clone.js');
var dimensions = require('./validation/dimensions.js');
var metadata = require('./utils/metadata.js');
var documentStatus = require('./utils/document-status.js');

/**
 * Returns documentIds for (documentId, locale) that have both draft and published,
 * optionally filtered by whether the draft is newer than the published row.
 * Uses strapi.documents only.
 */ const getDocumentIdsByDraftPublishRelation = async (uid, opts)=>{
    const schema = strapi.getModel(uid);
    if (!strapiUtils.contentTypes.hasDraftAndPublish(schema)) {
        return [];
    }
    const baseParams = {
        fields: [
            'documentId',
            'locale',
            'updatedAt'
        ],
        page: 1,
        pageSize: 10000,
        ...opts.locale != null && opts.locale !== '*' && {
            locale: opts.locale
        }
    };
    const [drafts, published] = await Promise.all([
        strapi.documents(uid).findMany({
            ...baseParams,
            status: 'draft'
        }),
        strapi.documents(uid).findMany({
            ...baseParams,
            status: 'published'
        })
    ]);
    const publishedByKey = new Map();
    for (const p of published){
        const key = `${p.documentId}\t${String(p?.locale ?? '')}`;
        publishedByKey.set(key, {
            updatedAt: p.updatedAt
        });
    }
    const ids = [];
    const wantModified = opts.type === 'modified';
    for (const d of drafts){
        const key = `${d.documentId}\t${String(d?.locale ?? '')}`;
        const pub = publishedByKey.get(key);
        if (pub) {
            const dUpdated = d?.updatedAt ? new Date(d.updatedAt).getTime() : 0;
            const pUpdated = pub?.updatedAt ? new Date(pub.updatedAt).getTime() : 0;
            const isModified = dUpdated > pUpdated;
            if (isModified === wantModified) {
                ids.push(d.documentId);
            }
        }
    }
    return [
        ...new Set(ids)
    ];
};
/** Map from __status filter value to top-level query fields (mirrors client STATUS_PARAMS). */ const STATUS_QUERY_FROM_FILTER = {
    draft: {
        status: 'draft',
        hasPublishedVersion: 'false'
    },
    published: {
        status: 'published'
    },
    'published-modified': {
        publicationStatusFilter: 'published-modified'
    },
    'published-unmodified': {
        publicationStatusFilter: 'published-unmodified'
    }
};
/**
 * Extracts __status from query.filters.$and into top-level status, hasPublishedVersion,
 * and publicationStatusFilter so list works with either transformed params or raw filter params.
 */ const normalizeStatusFromFilters = (query)=>{
    const filters = query.filters;
    if (!filters?.$and || !Array.isArray(filters.$and)) return;
    const remainingFilters = [];
    const statusValues = [];
    for (const filter of filters.$and){
        const eq = filter?.__status?.$eq;
        if (eq != null) {
            statusValues.push(String(eq));
        } else {
            remainingFilters.push(filter);
        }
    }
    if (statusValues.length === 0) return;
    const q = query;
    for (const value of statusValues){
        const toApply = STATUS_QUERY_FROM_FILTER[value];
        if (toApply) Object.assign(q, toApply);
    }
    if (remainingFilters.length > 0) {
        filters.$and = remainingFilters;
    } else {
        delete q.filters;
    }
};
/** Returns filters object that merges existing $and with a documentId $in filter. */ const mergeDocumentIdFilter = (existingFilters, documentIds)=>{
    const documentIdFilter = {
        documentId: documentIds.length > 0 ? {
            $in: documentIds
        } : {
            $in: []
        }
    };
    let existingAnd;
    if (existingFilters?.$and && Array.isArray(existingFilters.$and)) {
        existingAnd = existingFilters.$and;
    } else if (existingFilters && Object.keys(existingFilters).length > 0) {
        existingAnd = [
            existingFilters
        ];
    } else {
        existingAnd = [];
    }
    return {
        $and: [
            ...existingAnd,
            documentIdFilter
        ]
    };
};
/**
 * Create a new document.
 *
 * @param ctx - Koa context
 * @param opts - Options
 * @param opts.populate - Populate options of the returned document.
 *                        By default documentManager will populate all relations.
 */ const createDocument = async (ctx, opts)=>{
    const { userAbility, user } = ctx.state;
    const { model } = ctx.params;
    const { body } = ctx.request;
    const documentManager = index.getService('document-manager');
    const permissionChecker = index.getService('permission-checker').create({
        userAbility,
        model
    });
    if (permissionChecker.cannot.create()) {
        throw new strapiUtils.errors.ForbiddenError();
    }
    const pickPermittedFields = permissionChecker.sanitizeCreateInput;
    const setCreator = strapiUtils.setCreatorFields({
        user
    });
    const sanitizeFn = strapiUtils.async.pipe(pickPermittedFields, setCreator);
    const sanitizedBody = await sanitizeFn(body);
    const { locale, status } = await dimensions.getDocumentLocaleAndStatus(body, model);
    return documentManager.create(model, {
        data: sanitizedBody,
        locale,
        status,
        populate: opts?.populate
    });
// TODO: Revert the creation if create permission conditions are not met
// if (permissionChecker.cannot.create(document)) {
//   throw new errors.ForbiddenError();
// }
};
/**
 * Update a document version.
 * - If the document version exists, it will be updated.
 * - If the document version does not exist, a new document locale will be created.
 *   By default documentManager will populate all relations.
 *
 * @param ctx - Koa context
 * @param opts - Options
 * @param opts.populate - Populate options of the returned document
 */ const updateDocument = async (ctx, opts)=>{
    const { userAbility, user } = ctx.state;
    const { id, model } = ctx.params;
    const { body } = ctx.request;
    const documentManager = index.getService('document-manager');
    const permissionChecker = index.getService('permission-checker').create({
        userAbility,
        model
    });
    if (permissionChecker.cannot.update()) {
        throw new strapiUtils.errors.ForbiddenError();
    }
    // Populate necessary fields to check permissions
    const permissionQuery = await permissionChecker.sanitizedQuery.update(ctx.query);
    const populate = await index.getService('populate-builder')(model).populateFromQuery(permissionQuery).build();
    const { locale } = await dimensions.getDocumentLocaleAndStatus(body, model);
    // Load document version to update
    const [documentVersion, documentExists] = await Promise.all([
        documentManager.findOne(id, model, {
            populate,
            locale,
            status: 'draft'
        }),
        documentManager.exists(model, id)
    ]);
    if (!documentExists) {
        throw new strapiUtils.errors.NotFoundError();
    }
    // If version is not found, but document exists,
    // the intent is to create a new document locale
    if (documentVersion) {
        if (permissionChecker.cannot.update(documentVersion)) {
            throw new strapiUtils.errors.ForbiddenError();
        }
    } else if (permissionChecker.cannot.create()) {
        throw new strapiUtils.errors.ForbiddenError();
    }
    const pickPermittedFields = documentVersion ? permissionChecker.sanitizeUpdateInput(documentVersion) : permissionChecker.sanitizeCreateInput;
    const setCreator = documentVersion ? strapiUtils.setCreatorFields({
        user,
        isEdition: true
    }) : strapiUtils.setCreatorFields({
        user
    });
    const sanitizeFn = strapiUtils.async.pipe(pickPermittedFields, setCreator);
    const sanitizedBody = await sanitizeFn(body);
    const updatedDocument = await documentManager.update(documentVersion?.documentId || id, model, {
        data: sanitizedBody,
        populate: opts?.populate,
        locale
    });
    return updatedDocument;
};
var collectionTypes = {
    async find (ctx) {
        const { userAbility } = ctx.state;
        const { model } = ctx.params;
        const { query } = ctx.request;
        // Normalize so status/publicationStatusFilter are set from filters.$and.__status when present
        normalizeStatusFromFilters(query);
        const documentMetadata = index.getService('document-metadata');
        const documentManager = index.getService('document-manager');
        const permissionChecker = index.getService('permission-checker').create({
            userAbility,
            model
        });
        if (permissionChecker.cannot.read()) {
            return ctx.forbidden();
        }
        const permissionQuery = await permissionChecker.sanitizedQuery.read(query);
        const populate = await index.getService('populate-builder')(model).populateFromQuery(permissionQuery).populateDeep(1).countRelations({
            toOne: false,
            toMany: true
        }).build();
        // "Modified" is a UI-only filter; not a real document status. Read and strip it
        // so we never pass it to validation or the document service.
        const publicationStatusFilter = query.publicationStatusFilter;
        const queryForValidation = {
            ...query
        };
        delete queryForValidation.publicationStatusFilter;
        const { locale, status } = await dimensions.getDocumentLocaleAndStatus(queryForValidation, model);
        const paramsForDocumentService = fp.omit([
            'publicationStatusFilter'
        ], permissionQuery);
        let findPageParams = {
            ...paramsForDocumentService,
            populate,
            locale,
            status
        };
        // Pass through hasPublishedVersion so "Draft" filter returns only drafts with no published version
        if (query.hasPublishedVersion !== undefined) {
            findPageParams.hasPublishedVersion = query.hasPublishedVersion;
        }
        if (publicationStatusFilter === 'published-modified' || publicationStatusFilter === 'published-unmodified') {
            const type = publicationStatusFilter === 'published-modified' ? 'modified' : 'unmodified';
            const documentIds = await getDocumentIdsByDraftPublishRelation(model, {
                locale,
                type
            });
            findPageParams = {
                ...findPageParams,
                status: 'published',
                filters: mergeDocumentIdFilter(paramsForDocumentService.filters, documentIds)
            };
        }
        const { results: documents, pagination } = await documentManager.findPage(findPageParams, model);
        // TODO: Skip this part if not necessary (if D&P disabled or columns not displayed in the view)
        const documentsAvailableStatus = await documentMetadata.getManyAvailableStatus(model, documents);
        const statusByDocumentId = documentStatus.indexByDocumentId(documentsAvailableStatus);
        const setStatus = (document)=>{
            // Available status of document
            const availableStatuses = statusByDocumentId.get(document.documentId) || [];
            // Compute document version status
            document.status = documentMetadata.getStatus(document, availableStatuses);
            return document;
        };
        const results = await strapiUtils.async.map(documents, strapiUtils.async.pipe(permissionChecker.sanitizeOutput, setStatus));
        const _schema = strapi.contentTypes[model];
        if (_schema) {
            const _attrs = _schema.attributes || {};
            const _LK = ['_preview','name','title','defaultName','code','content','label','displayName','slug','role','action','placement','useCase'];
            for (const _rec of results) {
                for (const [_f, _a] of Object.entries(_attrs)) {
                    if (_a.type === 'component' && _rec[_f] != null && typeof _rec[_f] === 'object') {
                        const _v = _rec[_f];
                        if (Array.isArray(_v)) {
                            // Extract first item's label + count
                            let _label = '';
                            if (_v.length > 0 && _v[0] && typeof _v[0] === 'object') {
                                for (const _k of _LK) { if (typeof _v[0][_k] === 'string' && _v[0][_k]) { _label = _v[0][_k]; break; } }
                                if (!_label) { for (const _val of Object.values(_v[0])) { if (typeof _val === 'string' && _val && _val.length < 100) { _label = _val; break; } } }
                            }
                            if (_label && _v.length > 1) {
                                _rec[_f] = _label + ' (+' + (_v.length - 1) + ')';
                            } else if (_label) {
                                _rec[_f] = _label;
                            } else {
                                _rec[_f] = _v.length + ' item' + (_v.length !== 1 ? 's' : '');
                            }
                        } else {
                            let _flat = '';
                            for (const _k of _LK) { if (typeof _v[_k] === 'string' && _v[_k]) { _flat = _v[_k]; break; } }
                            if (!_flat) { for (const _val of Object.values(_v)) { if (typeof _val === 'string' && _val && _val.length < 100) { _flat = _val; break; } } }
                            _rec[_f] = _flat || null;
                        }
                    }
                }
            }
        }
        ctx.body = {
            results,
            pagination
        };
    },
    async findOne (ctx) {
        const { userAbility } = ctx.state;
        const { model, id } = ctx.params;
        const documentManager = index.getService('document-manager');
        const permissionChecker = index.getService('permission-checker').create({
            userAbility,
            model
        });
        if (permissionChecker.cannot.read()) {
            return ctx.forbidden();
        }
        const permissionQuery = await permissionChecker.sanitizedQuery.read(ctx.query);
        const populate = await index.getService('populate-builder')(model).populateFromQuery(permissionQuery).populateDeep(Infinity).countRelations().build();
        const { locale, status } = await dimensions.getDocumentLocaleAndStatus(ctx.query, model);
        const version = await documentManager.findOne(id, model, {
            populate,
            locale,
            status
        });
        if (!version) {
            // Check if document exists
            const exists = await documentManager.exists(model, id);
            if (!exists) {
                return ctx.notFound();
            }
            // If the requested locale doesn't exist, return an empty response
            const { meta } = await metadata.formatDocumentWithMetadata(permissionChecker, model, // @ts-expect-error TODO: fix
            {
                documentId: id,
                locale,
                publishedAt: null
            }, {
                availableLocales: true,
                availableStatus: false
            });
            ctx.body = {
                data: {},
                meta
            };
            return;
        }
        // if the user has condition that needs populated content, it's not applied because entity don't have relations populated
        if (permissionChecker.cannot.read(version)) {
            return ctx.forbidden();
        }
        // TODO: Count populated relations by permissions
        const sanitizedDocument = await permissionChecker.sanitizeOutput(version);
        ctx.body = await metadata.formatDocumentWithMetadata(permissionChecker, model, sanitizedDocument);
    },
    async create (ctx) {
        const { userAbility } = ctx.state;
        const { model } = ctx.params;
        const permissionChecker = index.getService('permission-checker').create({
            userAbility,
            model
        });
        const [totalEntries, document] = await Promise.all([
            strapi.db.query(model).count(),
            createDocument(ctx)
        ]);
        const sanitizedDocument = await permissionChecker.sanitizeOutput(document);
        ctx.status = 201;
        ctx.body = await metadata.formatDocumentWithMetadata(permissionChecker, model, sanitizedDocument, {
            // Empty metadata as it's not relevant for a new document
            availableLocales: false,
            availableStatus: false
        });
        if (totalEntries === 0) {
            strapi.telemetry.send('didCreateFirstContentTypeEntry', {
                eventProperties: {
                    model
                }
            });
        }
    },
    async update (ctx) {
        const { userAbility } = ctx.state;
        const { model } = ctx.params;
        const permissionChecker = index.getService('permission-checker').create({
            userAbility,
            model
        });
        const updatedVersion = await updateDocument(ctx);
        const sanitizedVersion = await permissionChecker.sanitizeOutput(updatedVersion);
        ctx.body = await metadata.formatDocumentWithMetadata(permissionChecker, model, sanitizedVersion);
    },
    async clone (ctx) {
        const { userAbility, user } = ctx.state;
        const { model, sourceId: id } = ctx.params;
        const { body } = ctx.request;
        const documentManager = index.getService('document-manager');
        const permissionChecker = index.getService('permission-checker').create({
            userAbility,
            model
        });
        if (permissionChecker.cannot.create()) {
            return ctx.forbidden();
        }
        const permissionQuery = await permissionChecker.sanitizedQuery.create(ctx.query);
        const populate = await index.getService('populate-builder')(model).populateFromQuery(permissionQuery).build();
        const { locale } = await dimensions.getDocumentLocaleAndStatus(body, model);
        const document = await documentManager.findOne(id, model, {
            populate,
            locale,
            status: 'draft'
        });
        if (!document) {
            return ctx.notFound();
        }
        const pickPermittedFields = permissionChecker.sanitizeCreateInput;
        const setCreator = strapiUtils.setCreatorFields({
            user
        });
        const excludeNotCreatable = clone.excludeNotCreatableFields(model, permissionChecker);
        const sanitizeFn = strapiUtils.async.pipe(pickPermittedFields, setCreator, excludeNotCreatable);
        const sanitizedBody = await sanitizeFn(body);
        const clonedDocument = await documentManager.clone(document.documentId, sanitizedBody, model);
        const sanitizedDocument = await permissionChecker.sanitizeOutput(clonedDocument);
        ctx.body = await metadata.formatDocumentWithMetadata(permissionChecker, model, sanitizedDocument, {
            // Empty metadata as it's not relevant for a new document
            availableLocales: false,
            availableStatus: false
        });
    },
    async autoClone (ctx) {
        const { model } = ctx.params;
        // Check if the model has fields that prevent auto cloning
        const prohibitedFields = clone.getProhibitedCloningFields(model);
        if (prohibitedFields.length > 0) {
            return ctx.badRequest('Entity could not be cloned as it has unique and/or relational fields. ' + 'Please edit those fields manually and save to complete the cloning.', {
                prohibitedFields
            });
        }
        await this.clone(ctx);
    },
    async delete (ctx) {
        const { userAbility } = ctx.state;
        const { id, model } = ctx.params;
        const documentManager = index.getService('document-manager');
        const permissionChecker = index.getService('permission-checker').create({
            userAbility,
            model
        });
        if (permissionChecker.cannot.delete()) {
            return ctx.forbidden();
        }
        const permissionQuery = await permissionChecker.sanitizedQuery.delete(ctx.query);
        const populate = await index.getService('populate-builder')(model).populateFromQuery(permissionQuery).build();
        const { locale } = await dimensions.getDocumentLocaleAndStatus(ctx.query, model);
        // Find locales to delete
        const documentLocales = await documentManager.findLocales(id, model, {
            populate,
            locale
        });
        if (documentLocales.length === 0) {
            return ctx.notFound();
        }
        for (const document of documentLocales){
            if (permissionChecker.cannot.delete(document)) {
                return ctx.forbidden();
            }
        }
        const result = await documentManager.delete(id, model, {
            locale
        });
        ctx.body = await permissionChecker.sanitizeOutput(result);
    },
    /**
   * Publish a document version.
   * Supports creating/saving a document and publishing it in one request.
   */ async publish (ctx) {
        const { userAbility } = ctx.state;
        // If id does not exist, the document has to be created
        const { id, model } = ctx.params;
        const { body } = ctx.request;
        const documentManager = index.getService('document-manager');
        const permissionChecker = index.getService('permission-checker').create({
            userAbility,
            model
        });
        if (permissionChecker.cannot.publish()) {
            return ctx.forbidden();
        }
        const publishedDocument = await strapi.db.transaction(async ()=>{
            // Create or update document
            const permissionQuery = await permissionChecker.sanitizedQuery.publish(ctx.query);
            const populate = await index.getService('populate-builder')(model).populateFromQuery(permissionQuery).populateDeep(Infinity).countRelations().build();
            let document;
            const { locale } = await dimensions.getDocumentLocaleAndStatus(body, model);
            /**
       * Publish can be called on two scenarios:
       * 1. Create a new document and publish it in one request
       * 2. Update an existing document and publish it in one request
       *
       * Based on user permissions:
       * 1. User cannot create a document, but can publish
       *    Action will be forbidden as user cannot create a document
       * 2. User can update and publish a document
       *    Action will be allowed, but document will not be updated, only published with the latest draft
       */ const isCreate = fp.isNil(id);
            if (isCreate) {
                if (permissionChecker.cannot.create()) {
                    throw new strapiUtils.errors.ForbiddenError();
                }
                document = await createDocument(ctx, {
                    populate
                });
            }
            const isUpdate = !isCreate;
            if (isUpdate) {
                // check if the document exists
                const documentExists = await documentManager.exists(model, id);
                if (!documentExists) {
                    throw new strapiUtils.errors.NotFoundError('Document not found');
                }
                // check the document version
                document = await documentManager.findOne(id, model, {
                    populate,
                    locale
                });
                if (!document) {
                    // update and publish the new version
                    if (permissionChecker.cannot.create({
                        locale
                    }) || permissionChecker.cannot.publish({
                        locale
                    })) {
                        throw new strapiUtils.errors.ForbiddenError();
                    }
                    document = await updateDocument(ctx);
                } else if (permissionChecker.can.update(document)) {
                    await updateDocument(ctx);
                }
            }
            if (permissionChecker.cannot.publish(document)) {
                throw new strapiUtils.errors.ForbiddenError();
            }
            const publishResult = await documentManager.publish(document.documentId, model, {
                locale
            });
            if (!publishResult || publishResult.length === 0) {
                throw new strapiUtils.errors.NotFoundError('Document not found or already published.');
            }
            return publishResult[0];
        });
        const sanitizedDocument = await permissionChecker.sanitizeOutput(publishedDocument);
        ctx.body = await metadata.formatDocumentWithMetadata(permissionChecker, model, sanitizedDocument);
    },
    async bulkPublish (ctx) {
        const { userAbility } = ctx.state;
        const { model } = ctx.params;
        const { body } = ctx.request;
        const { documentIds } = body;
        await index$1.validateBulkActionInput(body);
        const documentManager = index.getService('document-manager');
        const permissionChecker = index.getService('permission-checker').create({
            userAbility,
            model
        });
        if (permissionChecker.cannot.publish()) {
            return ctx.forbidden();
        }
        const permissionQuery = await permissionChecker.sanitizedQuery.publish(ctx.query);
        const populate = await index.getService('populate-builder')(model).populateFromQuery(permissionQuery).populateDeep(Infinity).countRelations().build();
        const { locale } = await dimensions.getDocumentLocaleAndStatus(body, model, {
            allowMultipleLocales: true
        });
        const entityPromises = documentIds.map((documentId)=>documentManager.findLocales(documentId, model, {
                populate,
                locale,
                isPublished: false
            }));
        const entities = (await Promise.all(entityPromises)).flat();
        for (const entity of entities){
            if (!entity) {
                return ctx.notFound();
            }
            if (permissionChecker.cannot.publish(entity)) {
                return ctx.forbidden();
            }
        }
        const count = await documentManager.publishMany(model, documentIds, locale);
        ctx.body = {
            count
        };
    },
    async bulkUnpublish (ctx) {
        const { userAbility } = ctx.state;
        const { model } = ctx.params;
        const { body } = ctx.request;
        const { documentIds } = body;
        await index$1.validateBulkActionInput(body);
        const documentManager = index.getService('document-manager');
        const permissionChecker = index.getService('permission-checker').create({
            userAbility,
            model
        });
        if (permissionChecker.cannot.unpublish()) {
            return ctx.forbidden();
        }
        const { locale } = await dimensions.getDocumentLocaleAndStatus(body, model, {
            allowMultipleLocales: true
        });
        const entityPromises = documentIds.map((documentId)=>documentManager.findLocales(documentId, model, {
                locale,
                isPublished: true
            }));
        const entities = (await Promise.all(entityPromises)).flat();
        for (const entity of entities){
            if (!entity) {
                return ctx.notFound();
            }
            if (permissionChecker.cannot.publish(entity)) {
                return ctx.forbidden();
            }
        }
        const entitiesIds = entities.map((document)=>document.documentId);
        const { count } = await documentManager.unpublishMany(entitiesIds, model, {
            locale
        });
        ctx.body = {
            count
        };
    },
    async unpublish (ctx) {
        const { userAbility } = ctx.state;
        const { id, model } = ctx.params;
        const { body: { discardDraft, ...body } } = ctx.request;
        const documentManager = index.getService('document-manager');
        const permissionChecker = index.getService('permission-checker').create({
            userAbility,
            model
        });
        if (permissionChecker.cannot.unpublish()) {
            return ctx.forbidden();
        }
        if (discardDraft && permissionChecker.cannot.discard()) {
            return ctx.forbidden();
        }
        const permissionQuery = await permissionChecker.sanitizedQuery.unpublish(ctx.query);
        const populate = await index.getService('populate-builder')(model).populateFromQuery(permissionQuery).build();
        // TODO allow multiple locales for bulk locale unpublish
        const { locale } = await dimensions.getDocumentLocaleAndStatus(body, model);
        const document = await documentManager.findOne(id, model, {
            populate,
            locale,
            status: 'published'
        });
        if (!document) {
            throw new strapiUtils.errors.NotFoundError();
        }
        if (permissionChecker.cannot.unpublish(document)) {
            throw new strapiUtils.errors.ForbiddenError();
        }
        if (discardDraft && permissionChecker.cannot.discard(document)) {
            throw new strapiUtils.errors.ForbiddenError();
        }
        await strapi.db.transaction(async ()=>{
            if (discardDraft) {
                await documentManager.discardDraft(document.documentId, model, {
                    locale
                });
            }
            ctx.body = await strapiUtils.async.pipe((document)=>documentManager.unpublish(document.documentId, model, {
                    locale
                }), permissionChecker.sanitizeOutput, (document)=>metadata.formatDocumentWithMetadata(permissionChecker, model, document))(document);
        });
    },
    async discard (ctx) {
        const { userAbility } = ctx.state;
        const { id, model } = ctx.params;
        const { body } = ctx.request;
        const documentManager = index.getService('document-manager');
        const permissionChecker = index.getService('permission-checker').create({
            userAbility,
            model
        });
        if (permissionChecker.cannot.discard()) {
            return ctx.forbidden();
        }
        const permissionQuery = await permissionChecker.sanitizedQuery.discard(ctx.query);
        const populate = await index.getService('populate-builder')(model).populateFromQuery(permissionQuery).build();
        const { locale } = await dimensions.getDocumentLocaleAndStatus(body, model);
        const document = await documentManager.findOne(id, model, {
            populate,
            locale,
            status: 'published'
        });
        // Can not discard a document that is not published
        if (!document) {
            return ctx.notFound();
        }
        if (permissionChecker.cannot.discard(document)) {
            return ctx.forbidden();
        }
        ctx.body = await strapiUtils.async.pipe((document)=>documentManager.discardDraft(document.documentId, model, {
                locale
            }), permissionChecker.sanitizeOutput, (document)=>metadata.formatDocumentWithMetadata(permissionChecker, model, document))(document);
    },
    async bulkDelete (ctx) {
        const { userAbility } = ctx.state;
        const { model } = ctx.params;
        const { query, body } = ctx.request;
        const { documentIds } = body;
        await index$1.validateBulkActionInput(body);
        const documentManager = index.getService('document-manager');
        const permissionChecker = index.getService('permission-checker').create({
            userAbility,
            model
        });
        if (permissionChecker.cannot.delete()) {
            return ctx.forbidden();
        }
        const permissionQuery = await permissionChecker.sanitizedQuery.delete(query);
        const populate = await index.getService('populate-builder')(model).populateFromQuery(permissionQuery).build();
        const { locale } = await dimensions.getDocumentLocaleAndStatus(body, model);
        const documentLocales = await documentManager.findLocales(documentIds, model, {
            populate,
            locale
        });
        if (documentLocales.length === 0) {
            return ctx.notFound();
        }
        for (const document of documentLocales){
            if (permissionChecker.cannot.delete(document)) {
                return ctx.forbidden();
            }
        }
        // We filter out documentsIds that maybe doesn't exist in a specific locale
        const localeDocumentsIds = documentLocales.map((document)=>document.documentId);
        const { count } = await documentManager.deleteMany(localeDocumentsIds, model, {
            locale
        });
        ctx.body = {
            count
        };
    },
    async countDraftRelations (ctx) {
        const { userAbility } = ctx.state;
        const { model, id } = ctx.params;
        const documentManager = index.getService('document-manager');
        const permissionChecker = index.getService('permission-checker').create({
            userAbility,
            model
        });
        if (permissionChecker.cannot.read()) {
            return ctx.forbidden();
        }
        const { locale, status } = await dimensions.getDocumentLocaleAndStatus(ctx.query, model);
        if (permissionChecker.requiresEntity.read()) {
            // Only load what we need for access checks
            const entity = await documentManager.findOne(id, model, {
                locale,
                status,
                populate: {}
            });
            if (!entity) {
                return ctx.notFound();
            }
            if (permissionChecker.cannot.read(entity)) {
                return ctx.forbidden();
            }
        }
        const number = await documentManager.countDraftRelations(id, model, locale);
        return {
            data: number
        };
    },
    async countManyEntriesDraftRelations (ctx) {
        const { userAbility } = ctx.state;
        const ids = ctx.request.query.documentIds;
        const locale = ctx.request.query.locale;
        const { model } = ctx.params;
        const documentManager = index.getService('document-manager');
        const permissionChecker = index.getService('permission-checker').create({
            userAbility,
            model
        });
        if (permissionChecker.cannot.read()) {
            return ctx.forbidden();
        }
        const documents = await documentManager.findMany({
            filters: {
                documentId: ids
            },
            locale
        }, model);
        if (!documents) {
            return ctx.notFound();
        }
        const number = await documentManager.countManyEntriesDraftRelations(ids, model, locale);
        return {
            data: number
        };
    }
};

module.exports = collectionTypes;
//# sourceMappingURL=collection-types.js.map
