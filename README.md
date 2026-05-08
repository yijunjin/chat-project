# chat-project


test-ai-agent/
├── src/
│   ├── agents/           # 智能体核心
│   │   ├── test-agent.js
│   │   └── test-orchestrator.js
│   ├── tools/           # 测试工具集
│   │   ├── code-analysis.js
│   │   ├── test-generator.js
│   │   ├── test-executor.js
│   │   └── report-analyzer.js
│   ├── memory/          # 记忆存储
│   │   └── test-memory.js
│   ├── prompts/         # 提示词模板
│   │   └── test-prompts.js
│   └── api/             # API接口
│       └── index.js
├── frontend/            # 前端界面（可选）
├── tests/               # 智能体自身的测试
└── package.json