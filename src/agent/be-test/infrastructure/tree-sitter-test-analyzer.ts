import { Injectable } from '@nestjs/common';
// native CommonJS binding — esModuleInterop 없는 환경 호환을 위해 `import = require()` 사용.
/* eslint-disable @typescript-eslint/no-require-imports */
import Parser = require('tree-sitter');
import TreeSitterTypeScript = require('tree-sitter-typescript');
/* eslint-enable @typescript-eslint/no-require-imports */

import {
  BranchPath,
  FileAnalysis,
  FunctionAnalysis,
  PortDependency,
} from '../domain/be-test.type';

type SyntaxNode = Parser.SyntaxNode;

// constructor 파라미터 중 @Inject(TOKEN) 데코레이터가 붙은 경우 injectToken 을 캡처한다.
// NestJS DI 패턴에서 Port 심볼 주입 여부를 판별하기 위함.
const INJECT_DECORATOR_REGEX = /^Inject$/;

@Injectable()
export class TreeSitterTestAnalyzer {
  private readonly parser: Parser;

  constructor() {
    this.parser = new Parser();
    // tree-sitter-typescript type export 가 unknown 으로 노출돼 단언 필요 (기존 TreeSitterParser 와 동일 패턴).
    this.parser.setLanguage(TreeSitterTypeScript.typescript as Parser.Language);
  }

  analyze(filePath: string, sourceCode: string): FileAnalysis {
    const tree = this.parser.parse(sourceCode);
    const root = tree.rootNode;

    let className: string | undefined;
    let ports: PortDependency[] = [];
    const functions: FunctionAnalysis[] = [];

    walk(root, (node) => {
      if (node.type === 'class_declaration') {
        className = node.childForFieldName('name')?.text ?? undefined;
        ports = extractPortsFromConstructor(node);
      }

      if (
        node.type === 'method_definition' ||
        node.type === 'function_declaration'
      ) {
        const fn = extractFunctionAnalysis(node);
        if (fn) {
          functions.push(fn);
        }
      }
    });

    const branchCount = functions.reduce(
      (acc, fn) => acc + fn.branches.length,
      0,
    );
    // cyclomatic complexity = 1 + 분기 개수 (간이 계산).
    const cyclomaticComplexity = 1 + branchCount;

    return {
      filePath,
      className,
      ports,
      functions,
      cyclomaticComplexity,
      rawSource: sourceCode,
    };
  }
}

const walk = (node: SyntaxNode, visit: (n: SyntaxNode) => void): void => {
  visit(node);
  for (const child of node.children) {
    walk(child, visit);
  }
};

const extractPortsFromConstructor = (
  classNode: SyntaxNode,
): PortDependency[] => {
  const ports: PortDependency[] = [];

  walk(classNode, (node) => {
    if (node.type !== 'formal_parameters') {
      return;
    }
    // constructor 의 formal_parameters 인지 확인 — 부모가 method_definition 이고 이름이 constructor.
    const parent = node.parent;
    if (!parent || parent.type !== 'method_definition') {
      return;
    }
    const methodName = parent.childForFieldName('name')?.text;
    if (methodName !== 'constructor') {
      return;
    }

    for (const param of node.children) {
      if (
        param.type !== 'required_parameter' &&
        param.type !== 'optional_parameter'
      ) {
        continue;
      }
      const port = extractPortDependency(param);
      if (port) {
        ports.push(port);
      }
    }
  });

  return ports;
};

const extractPortDependency = (
  paramNode: SyntaxNode,
): PortDependency | null => {
  const nameNode = paramNode.childForFieldName('name');
  if (!nameNode) {
    return null;
  }

  const typeAnnotation = paramNode.childForFieldName('type');
  const typeName = typeAnnotation
    ? typeAnnotation.text.replace(/^:\s*/, '').trim()
    : 'unknown';

  // Port 이름 패턴: *Port 로 끝나는 타입만 의미 있는 mock 대상으로 간주.
  if (!typeName.endsWith('Port')) {
    return null;
  }

  // @Inject(TOKEN) 데코레이터 탐색.
  let isInjectToken = false;
  let injectToken: string | undefined;

  for (const child of paramNode.children) {
    if (child.type === 'decorator') {
      const decoratorText = child.text;
      const match = decoratorText.match(/@Inject\(([^)]+)\)/);
      if (match && INJECT_DECORATOR_REGEX.test('Inject')) {
        isInjectToken = true;
        injectToken = match[1].trim();
      }
    }
  }

  return {
    paramName: nameNode.text,
    typeName,
    isInjectToken,
    injectToken,
  };
};

const extractFunctionAnalysis = (node: SyntaxNode): FunctionAnalysis | null => {
  const nameNode = node.childForFieldName('name');
  if (!nameNode) {
    return null;
  }

  const name = nameNode.text;
  // constructor 는 테스트 대상 메서드가 아니라 제외.
  if (name === 'constructor') {
    return null;
  }

  const startLine = node.startPosition.row + 1;
  const endLine = node.endPosition.row + 1;
  const isAsync = node.children.some((c) => c.type === 'async');

  const paramsNode = node.childForFieldName('parameters');
  const parameters = paramsNode ? extractParameters(paramsNode) : [];

  const branches = extractBranches(node);

  return { name, startLine, endLine, branches, parameters, isAsync };
};

const extractParameters = (
  paramsNode: SyntaxNode,
): { name: string; type: string }[] => {
  const params: { name: string; type: string }[] = [];
  for (const child of paramsNode.children) {
    if (
      child.type !== 'required_parameter' &&
      child.type !== 'optional_parameter'
    ) {
      continue;
    }
    const nameNode = child.childForFieldName('name');
    const typeNode = child.childForFieldName('type');
    if (nameNode) {
      params.push({
        name: nameNode.text,
        type: typeNode ? typeNode.text.replace(/^:\s*/, '').trim() : 'unknown',
      });
    }
  }
  return params;
};

const extractBranches = (fnNode: SyntaxNode): BranchPath[] => {
  const branches: BranchPath[] = [];

  walk(fnNode, (node) => {
    // 함수 자신의 노드는 건너뜀 — 내부 노드만 대상.
    if (node === fnNode) {
      return;
    }

    switch (node.type) {
      case 'if_statement': {
        const condNode = node.childForFieldName('condition');
        branches.push({
          kind: 'if',
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          condition: condNode ? extractText(condNode) : '',
        });
        break;
      }
      case 'else_clause': {
        branches.push({
          kind: 'else',
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          condition: 'else',
        });
        break;
      }
      case 'switch_case': {
        const valueNode = node.childForFieldName('value');
        branches.push({
          kind: 'switch-case',
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          condition: valueNode ? extractText(valueNode) : 'default',
        });
        break;
      }
      case 'ternary_expression': {
        const condNode = node.childForFieldName('condition');
        branches.push({
          kind: 'ternary',
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          condition: condNode ? extractText(condNode) : '',
        });
        break;
      }
      case 'try_statement': {
        branches.push({
          kind: 'try-catch',
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          condition: 'try-catch',
        });
        break;
      }
    }
  });

  return branches;
};

const extractText = (node: SyntaxNode): string => node.text.slice(0, 200);
