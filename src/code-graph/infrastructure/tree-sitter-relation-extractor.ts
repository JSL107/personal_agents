import { Injectable } from '@nestjs/common';
import Parser from 'tree-sitter';
import TreeSitterTypeScript from 'tree-sitter-typescript';

import { CodeRelation } from '../domain/code-relation.type';
import { CodeRelationExtractorPort } from '../domain/port/code-relation-extractor.port';

type SyntaxNode = Parser.SyntaxNode;

// V3 SOTA Foundation 1.1 단계 2 — Tree-sitter 기반 Relation Indexer.
// import_statement / class_declaration / interface_declaration / call_expression 노드를 walk 하며
// 4종 CodeRelation 추출. 이대리 Port-Adapter 패턴 (Symbol-based Port + implements) 은 일반 implements
// relation 으로 자연 매핑돼 별도 특수 처리 X — 단계 4 query 에서 Port 이름으로 필터.
@Injectable()
export class TreeSitterRelationExtractor implements CodeRelationExtractorPort {
  private readonly parser: Parser;

  constructor() {
    this.parser = new Parser();
    this.parser.setLanguage(TreeSitterTypeScript.typescript as Parser.Language);
  }

  extractRelations({
    filePath,
    source,
  }: {
    filePath: string;
    source: string;
  }): CodeRelation[] {
    const tree = this.parser.parse(source);
    const relations: CodeRelation[] = [];
    walk(tree.rootNode, (node) => {
      switch (node.type) {
        case 'import_statement': {
          const rel = extractImport(filePath, node);
          if (rel) {
            relations.push(rel);
          }
          break;
        }
        case 'class_declaration':
        case 'interface_declaration': {
          const name = node.childForFieldName('name')?.text;
          if (name) {
            relations.push(...extractHeritage(node, name));
          }
          break;
        }
        case 'call_expression': {
          const rel = extractCall(filePath, node);
          if (rel) {
            relations.push(rel);
          }
          break;
        }
      }
    });
    return relations;
  }
}

const walk = (node: SyntaxNode, visit: (n: SyntaxNode) => void): void => {
  visit(node);
  for (const child of node.children) {
    walk(child, visit);
  }
};

// import_statement 예시:
//   import { A, B } from './foo';   → symbols = ['A', 'B'], to = './foo'
//   import Foo from './bar';        → symbols = ['Foo'], to = './bar'
//   import * as ns from 'pkg';      → symbols = ['ns'] (namespace_import), to = 'pkg'
const extractImport = (
  filePath: string,
  node: SyntaxNode,
): CodeRelation | null => {
  const sourceNode = node.childForFieldName('source');
  if (!sourceNode) {
    return null;
  }
  const to = sourceNode.text.replace(/^['"]|['"]$/g, '');

  const symbols: string[] = [];
  walk(node, (n) => {
    if (n.type === 'import_specifier') {
      const named = n.childForFieldName('name');
      if (named) {
        symbols.push(named.text);
      }
    } else if (
      n.type === 'identifier' &&
      n.parent?.type === 'import_clause'
    ) {
      // default import — `import Foo from './bar'` 에서 Foo 가 import_clause 직계 identifier.
      symbols.push(n.text);
    } else if (n.type === 'namespace_import') {
      // `import * as ns from 'pkg'` — namespace_import 안의 identifier.
      const named = n.children.find((c) => c.type === 'identifier');
      if (named) {
        symbols.push(named.text);
      }
    }
  });
  return { kind: 'imports', from: filePath, to, symbols };
};

// class extends X / class implements Y, Z / interface extends A.
const extractHeritage = (
  node: SyntaxNode,
  fromName: string,
): CodeRelation[] => {
  const relations: CodeRelation[] = [];
  for (const child of node.children) {
    if (child.type === 'class_heritage') {
      for (const sub of child.children) {
        if (sub.type === 'extends_clause') {
          const target = findHeritageTarget(sub);
          if (target) {
            relations.push({
              kind: 'extends',
              from: fromName,
              to: target,
            });
          }
        } else if (sub.type === 'implements_clause') {
          for (const c of sub.children) {
            const target = extractTypeName(c);
            if (target) {
              relations.push({
                kind: 'implements',
                from: fromName,
                to: target,
              });
            }
          }
        }
      }
    } else if (child.type === 'extends_type_clause') {
      // interface 의 extends 는 class_heritage 가 아닌 extends_type_clause 직계.
      for (const c of child.children) {
        const target = extractTypeName(c);
        if (target) {
          relations.push({
            kind: 'extends',
            from: fromName,
            to: target,
          });
        }
      }
    }
  }
  return relations;
};

const findHeritageTarget = (clause: SyntaxNode): string | null => {
  for (const c of clause.children) {
    const target = extractTypeName(c);
    if (target) {
      return target;
    }
  }
  return null;
};

// Type 이름 추출 — 다음 형태 모두 지원 (codex review P2):
// - 단순 식별자: `Base` → 'Base'
// - 제네릭: `NestInterceptor<T>` → 'NestInterceptor' (generic_type 의 첫 자식)
// - 네임스페이스: `Namespace.Port` → 'Namespace.Port' (nested_type_identifier 그대로)
// - 표현식: `obj.Klass` → 'obj.Klass' (member_expression 그대로)
const extractTypeName = (node: SyntaxNode): string | null => {
  switch (node.type) {
    case 'identifier':
    case 'type_identifier':
      return node.text;
    case 'nested_type_identifier':
    case 'member_expression':
      return node.text;
    case 'generic_type': {
      const inner = node.children.find(
        (c) =>
          c.type === 'type_identifier' ||
          c.type === 'identifier' ||
          c.type === 'nested_type_identifier' ||
          c.type === 'member_expression',
      );
      return inner ? extractTypeName(inner) : null;
    }
    default:
      return null;
  }
};

// call_expression: foo(...) / obj.method(...) / Foo.bar(...). 의미 있는 call 만 노이즈 적게 추출
// 하려면 enclosing function context 가 필요한데 PoC 단계에서는 file-level 매핑으로 충분.
const extractCall = (
  filePath: string,
  node: SyntaxNode,
): CodeRelation | null => {
  const callee = node.childForFieldName('function');
  if (!callee) {
    return null;
  }
  return {
    kind: 'calls',
    from: filePath,
    to: callee.text,
    callSite: { line: node.startPosition.row + 1 },
  };
};
