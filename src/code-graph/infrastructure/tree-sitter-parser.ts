import { Injectable } from '@nestjs/common';
// tree-sitter 는 native CommonJS binding 이라 default 합성이 esModuleInterop 없는 환경에서 깨진다.
// `import = require()` 형식으로 module.exports 를 직접 가져온다.
/* eslint-disable @typescript-eslint/no-require-imports */
import Parser = require('tree-sitter');
import TreeSitterTypeScript = require('tree-sitter-typescript');
/* eslint-enable @typescript-eslint/no-require-imports */

import { CodeChunk, CodeChunkKind } from '../domain/code-chunk.type';
import { CodeParserPort } from '../domain/port/code-parser.port';

// V3 SOTA Foundation 1.1 단계 1 — Tree-sitter 기반 .ts chunker.
// tree-sitter 의 grammar 노드 type → 도메인 CodeChunkKind 매핑. method_definition 은 class 안에서만
// 의미가 있어 부모(class_declaration) 와 함께 양쪽 chunk 로 추출 (LLM prompt 에 양쪽 모두 노출 가능).
const NODE_TYPE_TO_KIND: Record<string, CodeChunkKind> = {
  class_declaration: 'class',
  function_declaration: 'function',
  method_definition: 'method',
  interface_declaration: 'interface',
  type_alias_declaration: 'type-alias',
};

// tree-sitter 의 SyntaxNode type 이 패키지 default export 의 nested type 으로만 노출돼 import 가 까다로움.
// 본 모듈에서만 쓰는 minimal shape 으로 alias.
type SyntaxNode = Parser.SyntaxNode;

@Injectable()
export class TreeSitterParser implements CodeParserPort {
  private readonly parser: Parser;

  constructor() {
    this.parser = new Parser();
    // tree-sitter-typescript 의 `typescript` export 는 unknown 타입으로 노출돼 setLanguage(Parser.Language)
    // 와 직접 호환되지 않음 (codex review P1). 안전하게 Language 로 단언 — 동작은 정상이며 패키지 type 한계.
    this.parser.setLanguage(TreeSitterTypeScript.typescript as Parser.Language);
  }

  parseFile({
    filePath,
    source,
  }: {
    filePath: string;
    source: string;
  }): CodeChunk[] {
    const tree = this.parser.parse(source);
    const chunks: CodeChunk[] = [];
    walk(tree.rootNode, (node) => {
      const kind = NODE_TYPE_TO_KIND[node.type];
      if (!kind) {
        return;
      }
      const name = extractName(node);
      if (!name) {
        return;
      }
      chunks.push({
        filePath,
        kind,
        name,
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        source: node.text,
      });
    });
    return chunks;
  }
}

const walk = (node: SyntaxNode, visit: (n: SyntaxNode) => void): void => {
  visit(node);
  for (const child of node.children) {
    walk(child, visit);
  }
};

// class/function/interface/type-alias 는 'name' field 의 identifier.
// method_definition 은 'name' field 의 property_identifier.
const extractName = (node: SyntaxNode): string | null => {
  const named = node.childForFieldName('name');
  if (named) {
    return named.text;
  }
  // fallback — field 가 없으면 직계 children 중 식별자류 찾기.
  const identifier = node.children.find(
    (c) =>
      c.type === 'identifier' ||
      c.type === 'property_identifier' ||
      c.type === 'type_identifier',
  );
  return identifier?.text ?? null;
};
