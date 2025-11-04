// OpenAPI相关类型定义
export interface SwaggerConfig {
  configUrl: string;
  urls: Array<{
    name: string;
    url: string;
  }>;
}
export type Paths = Record<string, PathItem>;

export type MarkDownGroup = Record<keyof MarkDownDes, MarkDownDes[]>;

export interface OpenAPISpec {
  openapi: string;
  info: {
    contact: {
      email: string;
      name: string;
      url: string;
    };
    description?: string;
    license: {
      name: string;
    };
    title: string;
    version: string;
  };
  security?: any[];
  paths: Paths;
  components: {
    schemas: Record<string, SchemaObject>;
    securitySchemes?: Record<string, SecuritySchemeObject>;
  };
  'x-nextdoc4j': {
    brand?: Brand;
    markdown?: MarkDownDes[];
  };
  servers?: {
    description: string;
    url: string;
  }[];
}

export interface Brand {
  footerText: string;
  logo: string;
  title: string;
}

export interface MarkDownDes {
  content: string;
  contentLength: string;
  displayName: string;
  filename: string;
  group: string;
  lastModified: string;
}

export interface PathItem {
  [method: string]: OperationObject;
  operationId: string;
}

export interface ApiData {
  [group: string]: {
    [tag: string]: ApiInfo[];
  };
}

export interface OperationObject {
  tags?: string[];
  summary?: string;
  description?: string;
  operationId?: string;
  parameters?: ParameterObject[];
  requestBody?: RequestBodyObject;
  responses?: Record<string, ResponseObject>;
}

export interface RequestBody {
  description?: string;
  content: {
    [key: string]: {
      schema: Schema;
    };
  };
  required?: boolean;
}

export interface Schema {
  type?: string;
  format?: string;
  enum?: string[];
  properties?: Record<string, Schema>;
  items?: Schema;
  $ref?: string;
  description?: string;
  required?: string[];
  example?: any;
  allOf?: Schema[];
  oneOf?: Schema[];
}

// 添加树节点类型定义
export interface TreeNode {
  key: string;
  title: string;
  type?: string;
  description?: string;
  children?: TreeNode[];
}

// 添加参数对象类型定义
export interface ParameterObject {
  name: string;
  in: 'cookie' | 'header' | 'path' | 'query';
  description?: string;
  required?: boolean;
  schema: SchemaObject;
  example?: any;
}

// 添加请求体对象类型定义
export interface RequestBodyObject {
  description?: string;
  content: {
    [key: string]: {
      schema: SchemaObject;
    };
  };
  required?: boolean;
}

// 添加响应对象类型定义
export interface ResponseObject {
  description: string;
  content?: {
    [key: string]: {
      schema: SchemaObject;
    };
  };
  schema?: SchemaObject;
}

// 添加 Schema 对象类型定义
export interface SchemaObject {
  type?: string;
  format?: string;
  enum?: any[];
  properties?: Record<string, SchemaObject>;
  items?: SchemaObject;
  $ref?: string;
  description?: string;
  required?: string[];
  example?: any;
  title?: string;
}

export type Method = 'delete' | 'get' | 'patch' | 'post' | 'put';

export type PathMenuItem = OperationObject & {
  method: Method;
  path: string;
  security: any[];
};

// 添加 SecurityScheme 对象类型定义
export interface SecuritySchemeObject {
  type: string;
  in: string;
  name: string;
  scheme: string;
  description: string;
}

export interface ApiInfo {
  method: string;
  path: string;
  tags: string[];
  summary?: string;
  description?: string;
  operationId: string;
  parameters: Parameter[];
  requestBody: RequestBody;
  responses: {
    [statusCode: string]: Response;
  };
  security: SecurityRequirement[];
}

export interface Response {
  description: string;
  content?: {
    [key: string]: {
      schema: Schema;
    };
  };
  schema?: Schema;
}

interface Parameter {
  name: string;
  in: 'path' | 'query';
  required: boolean;
  schema: Schema;
  example?: string;
  default?: string;
  description?: string;
}

interface SecurityRequirement {
  [name: string]: string[];
}
