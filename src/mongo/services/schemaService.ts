import { Db, Cursor } from 'mongodb';
import { LanguageService as JsonLanguageService, SchemaConfiguration } from 'vscode-json-languageservice';
import { JSONSchema } from 'vscode-json-languageservice/lib/jsonSchema';

export default class SchemaService {

	private _db: Db;

	registerSchemas(db: Db): Thenable<SchemaConfiguration[]> {
		this._db = db;
		return this._db.collections()
			.then(collections => {
				const schemas: SchemaConfiguration[] = [];
				for (const collection of collections) {
					schemas.push({
						uri: this.queryCollectionSchema(collection.collectionName),
						fileMatch: [this.queryDocumentUri()]
					})
				}
				return schemas;
			});
	}

	queryCollectionSchema(collectionName: string): string {
		return 'mongo://query/' + collectionName;
	}

	queryDocumentUri(): string {
		return 'mongo://query.json'
	}

	resolveSchema(uri: string): Thenable<string> {
		if (uri.startsWith('mongo://query/')) {
			return this._resolveQueryCollectionSchema(uri.substring('mongo://query/'.length), uri)
		}
	}

	private _resolveQueryCollectionSchema(collectionName: string, schemaUri: string): Thenable<string> {
		const collection = this._db.collection(collectionName)
		const cursor = collection.find();
		return new Promise((c, e) => {
			this.readNext([], cursor, 10, (result) => {
				const schema: JSONSchema = {
					type: 'object',
					properties: {}
				}
				for (const document of result) {
					this.setSchemaForDocument(null, document, schema);
				}
				this.setGlobalOperatorProperties(schema);
				this.setLogicalOperatorProperties(schema, schemaUri);
				c(JSON.stringify(schema));
			});
		})
	}

	private setSchemaForDocument(parent: string, document: any, schema: JSONSchema): void {
		const type = Array.isArray(document) ? 'array' : typeof document;
		if (type === 'object') {
			for (const property of Object.keys(document)) {
				if (!parent &&
					['_id'].indexOf(property) !== -1) {
					continue;
				}
				this.setSchemaForDocumentProperty(parent, property, document, schema);
			}
		}
	}

	private setSchemaForDocumentProperty(parent: string, property: string, document: any, schema: JSONSchema): void {
		const scopedProperty = parent ? `${parent}.${property}` : property;
		const value = document[property]
		const type = Array.isArray(value) ? 'array' : typeof value;

		const propertySchema: JSONSchema = {
			type: [type, 'object']
		}
		this.setOperatorProperties(type, propertySchema);
		schema.properties[scopedProperty] = propertySchema;

		if (type === 'object') {
			this.setSchemaForDocument(scopedProperty, value, schema);
		}

		if (type === 'array') {
			for (const v of value) {
				this.setSchemaForDocument(scopedProperty, v, schema);
			}
		}
	}

	private setGlobalOperatorProperties(schema: JSONSchema): void {
		schema.properties.$text = <JSONSchema>{
			type: 'object',
			description: 'Performs text search',
			properties: {
				$search: <JSONSchema>{
					type: 'string',
					description: 'A string of terms that MongoDB parses and uses to query the text index. MongoDB performs a logical OR search of the terms unless specified as a phrase',
				},
				$language: {
					type: 'string',
					description: 'Optional. The language that determines the list of stop words for the search and the rules for the stemmer and tokenizer. If not specified, the search uses the default language of the index.\nIf you specify a language value of "none", then the text search uses simple tokenization with no list of stop words and no stemming'
				},
				$caseSensitive: {
					type: 'boolean',
					description: 'Optional. A boolean flag to enable or disable case sensitive search. Defaults to false; i.e. the search defers to the case insensitivity of the text index'
				},
				$diacriticSensitive: {
					type: 'boolean',
					description: `Optional. A boolean flag to enable or disable diacritic sensitive search against version 3 text indexes.Defaults to false; i.e.the search defers to the diacritic insensitivity of the text index
Text searches against earlier versions of the text index are inherently diacritic sensitive and cannot be diacritic insensitive. As such, the $diacriticSensitive option has no effect with earlier versions of the text index`
				}
			},
			required: ['$search']
		};

		schema.properties.$where = {
			type: 'string',
			description: `Matches documents that satisfy a JavaScript expression.
Use the $where operator to pass either a string containing a JavaScript expression or a full JavaScript function to the query system`
		};
		schema.properties.$comment = {
			type: 'string',
			description: 'Adds a comment to a query predicate'
		};
	}

	private setLogicalOperatorProperties(schema: JSONSchema, schemaUri: string): void {
		schema.properties.$or = {
			type: 'array',
			description: 'Joins query clauses with a logical OR returns all documents that match the conditions of either clause',
			items: <JSONSchema>{
				$ref: schemaUri
			}
		};
		schema.properties.$and = {
			type: 'array',
			description: 'Joins query clauses with a logical AND returns all documents that match the conditions of both clauses',
			items: <JSONSchema>{
				$ref: schemaUri
			}
		};
		schema.properties.$nor = {
			type: 'array',
			description: 'Joins query clauses with a logical NOR returns all documents that fail to match both clauses',
			items: <JSONSchema>{
				$ref: schemaUri
			}
		};
	}

	private setOperatorProperties(type: string, schema: JSONSchema): void {
		if (!schema.properties) {
			schema.properties = {};
		}

		const expressionSchema = {
			properties: <any>{}
		}
		// Comparison operators
		expressionSchema.properties.$eq = {
			type: type,
			description: 'Matches values that are equal to a specified value'
		};
		expressionSchema.properties.$gt = {
			type: type,
			description: 'Matches values that are greater than a specified value'
		};
		expressionSchema.properties.$gte = {
			type: type,
			description: 'Matches values that are greater than or equal to a specified value'
		};
		expressionSchema.properties.$lt = {
			type: type,
			description: 'Matches values that are less than a specified value'
		};
		expressionSchema.properties.$lte = {
			type: type,
			description: 'Matches values that are less than or equal to a specified value'
		};
		expressionSchema.properties.$ne = {
			type: type,
			description: 'Matches all values that are not equal to a specified value'
		};
		expressionSchema.properties.$in = {
			type: 'array',
			description: 'Matches any of the values specified in an array'
		};
		expressionSchema.properties.$nin = {
			type: 'array',
			description: 'Matches none of the values specified in an array'
		};

		// Element operators
		expressionSchema.properties.$exists = {
			type: 'boolean',
			description: 'Matches documents that have the specified field'
		};
		expressionSchema.properties.$type = {
			type: 'string',
			description: 'Selects documents if a field is of the specified type'
		};

		// Evaluation operators
		expressionSchema.properties.$mod = {
			type: 'array',
			description: 'Performs a modulo operation on the value of a field and selects documents with a specified result',
			maxItems: 2,
			default: [2, 0]
		};
		expressionSchema.properties.$regex = {
			type: 'string',
			description: 'Selects documents where values match a specified regular expression',
		};

		// Geospatial
		const geometryPropertySchema: JSONSchema = {
			type: 'object',
			properties: {
				type: {
					type: 'string',
					default: 'GeoJSON object type'
				},
				coordinates: {
					type: 'array'
				},
				crs: {
					type: 'object',
					properties: {
						type: {
							type: 'string'
						},
						properties: {
							type: 'object'
						}
					}
				}
			}
		}
		expressionSchema.properties.$geoWithin = {
			type: 'object',
			description: 'Selects geometries within a bounding GeoJSON geometry. The 2dsphere and 2d indexes support $geoWithin',
			properties: {
				$geometry: geometryPropertySchema,
				$box: {
					type: 'array'
				},
				$polygon: {
					type: 'array'
				},
				$center: {
					type: 'array'
				},
				$centerSphere: {
					type: 'array'
				}
			}
		};
		expressionSchema.properties.$geoIntersects = {
			type: 'object',
			description: 'Selects geometries that intersect with a GeoJSON geometry. The 2dsphere index supports $geoIntersects',
			properties: {
				$geometry: geometryPropertySchema
			}
		};
		expressionSchema.properties.$near = {
			type: 'object',
			description: 'Returns geospatial objects in proximity to a point. Requires a geospatial index. The 2dsphere and 2d indexes support $near',
			properties: {
				$geometry: geometryPropertySchema,
				$maxDistance: {
					type: 'number'
				},
				$minDistance: {
					type: 'number'
				}
			}
		};
		expressionSchema.properties.$nearSphere = {
			type: 'object',
			description: 'Returns geospatial objects in proximity to a point. Requires a geospatial index. The 2dsphere and 2d indexes support $near',
			properties: {
				$geometry: geometryPropertySchema,
				$maxDistance: {
					type: 'number'
				},
				$minDistance: {
					type: 'number'
				}
			}
		};

		// Array operatos
		if (type === 'array') {
			expressionSchema.properties.$all = {
				type: 'array',
				description: 'Matches arrays that contain all elements specified in the query',
			};
			expressionSchema.properties.$size = {
				type: 'number',
				description: 'Selects documents if the array field is a specified size',
			};
		}

		// Bit operators
		expressionSchema.properties.$bitsAllSet = {
			type: 'array',
			description: 'Matches numeric or binary values in which a set of bit positions all have a value of 1',
		};
		expressionSchema.properties.$bitsAnySet = {
			type: 'array',
			description: 'Matches numeric or binary values in which any bit from a set of bit positions has a value of 1',
		};
		expressionSchema.properties.$bitsAllClear = {
			type: 'array',
			description: 'Matches numeric or binary values in which a set of bit positions all have a value of 0',
		};
		expressionSchema.properties.$bitsAnyClear = {
			type: 'array',
			description: 'Matches numeric or binary values in which any bit from a set of bit positions has a value of 0',
		};

		schema.properties = { ...expressionSchema.properties };
		schema.properties.$not = {
			type: 'object',
			description: 'Inverts the effect of a query expression and returns documents that do not match the query expression',
			properties: { ...expressionSchema.properties }
		};
		schema.properties.$elemMatch = {
			type: 'object',
		};
	}

	private readNext(result: any[], cursor: Cursor<any>, batchSize: number, callback: (result: any[]) => void): void {
		if (result.length === batchSize) {
			callback(result);
			return;
		}

		cursor.hasNext().then(hasNext => {
			if (!hasNext) {
				callback(result);
				return;
			}

			cursor.next().then(doc => {
				result.push(doc);
				this.readNext(result, cursor, batchSize, callback);
			})
		})
	}

}