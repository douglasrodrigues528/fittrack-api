# Publicação segura do FitTrack

Arquitetura sugerida: **Vercel** (frontend Next.js) → **Render** (API NestJS) → **PostgreSQL gerenciado** (Render, Neon, Supabase…), sempre uma instância de produção separada da local.

## 0. Antes de publicar (checklist)

- [ ] `npm run build` e `npm test` passam na raiz; `npm run build`, `npm run typecheck` e `npm test` passam em `frontend/`.
- [ ] Nenhum `.env` no Git (`git ls-files | grep -i "\.env"` deve listar apenas `*.env.example`).
- [ ] Senhas/segredos que já apareceram em README, histórico do Git ou prints foram trocados (ex.: `DB_PASSWORD=123456`, `JWT_SECRET=jwt-secret-key`).
- [ ] Licenças verificadas (seção 6).

## 1. Banco de produção

1. Crie o PostgreSQL gerenciado e copie a **connection string** (`DATABASE_URL`).
2. **Não use `synchronize` em produção.** Crie as tabelas com a migration (idempotente, não apaga dados; serve para banco vazio e para banco já existente): com `DATABASE_URL` do banco de produção, rode `npm run build && npm run migration:run:prod`. Faça backup antes.
3. Catálogo de exercícios: com `DATABASE_URL` apontando para o banco de produção, rode uma vez `node scripts/sync-exercises.cjs` (cria a tabela `exercises` se faltar e importa os 873 exercícios; é idempotente).
   - Os dados **não fazem parte do repositório**: a pasta `data/exercises/` não é versionada. O script baixa o JSON traduzido da fonte configurada nele (`DATASET_URL`) e grava uma cópia local nessa pasta.
   - Antes de importar em produção ou de versionar esses dados, conclua a verificação de licenças e de redistribuição da seção 6 (base original e tradução).
4. Ative backups automáticos no provedor.

## 2. API no Render (Web Service)

- Build: `npm ci && npm run build` · Start: `npm run start:prod` (rode `npm run migration:run:prod` a cada deploy que trouxer migration nova)
- Variáveis de ambiente (painel do Render, nunca no Git):

| Variável | Valor |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | string de conexão do banco de produção |
| `DB_SSL` | `true` (se o provedor exigir SSL) |
| `DB_SYNCHRONIZE` | `false` |
| `JWT_SECRET` | aleatório, ≥ 32 caracteres (`node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`) — a API recusa subir sem ele |
| `CORS_ORIGINS` | `https://seu-app.vercel.app` (vários: separados por vírgula) |
| `ENABLE_SWAGGER` | `false` |
| `TRUST_PROXY` | `1` (Render e outros serviços atrás de proxy) — faz a API ver o IP real do cliente e ativa o limite de tentativas de login por IP. Sem ela, em produção vale só o limite por conta. |

- `PORT` é fornecida pelo Render; a API já a lê e escuta em `0.0.0.0`.
- Teste: `GET https://<api>/exercises?limit=1` deve responder 200.

## 3. Frontend na Vercel

- Root Directory: `frontend`. Variável: `NEXT_PUBLIC_API_URL=https://<api>.onrender.com` (sem `/` no final).
- Depois do primeiro deploy, copie a URL final da Vercel para `CORS_ORIGINS` na API e faça redeploy da API.

## 4. Segurança — estado atual e o que falta

Contas e login: excluir a conta apaga treinos, sessões e séries (migration `CascadeWorkoutsOnUserDelete`); trocar o e-mail para um já usado responde 409; trocar a senha exige `currentPassword` e invalida todos os tokens emitidos antes (coluna `users.tokenVersion`, criada pela migration `AddUserTokenVersion`, conferida a cada requisição — sem essa migration o login responde 500 em produção); 5 senhas erradas em 15 min bloqueiam a conta por até 15 min (429 + `Retry-After`) e 50 falhas por IP bloqueiam o IP. Os contadores de login ficam em memória: com mais de uma instância da API, cada uma conta separadamente.

Já feito neste código: segredo JWT e CORS por ambiente; Swagger desligável; `synchronize` desligado por padrão em produção; credenciais padrão removidas da tela de login; PATCH de treinos/usuários agora validado (antes dava para sobrescrever `userId`); `/users/:id` restrito à própria conta (antes qualquer usuário logado podia editar/excluir outros); `GET /users` (listar todos) removido, use `GET /users/me`.

Ainda recomendado: `helmet` e limite de requisições em `POST /users` (cadastro); mover o JWT de `localStorage` para cookie `HttpOnly` (hoje um XSS roubaria o token); política de senha mais forte; cache em memória só funciona com **uma** instância da API (para escalar, use Redis); logs estruturados e monitoramento de erros; `rejectUnauthorized:false` no SSL do banco aceita qualquer certificado — prefira o CA do provedor.

## 5. Ordem de implantação

1. Banco + migration + importação do catálogo → 2. API (conferir `/exercises`) → 3. Frontend → 4. Atualizar `CORS_ORIGINS` → 5. Criar uma conta de teste, montar e salvar um treino, reabrir e editar → 6. Revisar logs.

Rollback: Render e Vercel permitem voltar ao deploy anterior; mantenha o backup do banco antes de cada migration.

## 6. Imagens e licenças (verificar antes de publicar)

- As imagens são carregadas direto do `raw.githubusercontent.com` do repositório `yuhonas/free-exercise-db` (variável `EXERCISE_IMAGES_BASE_URL`). Não foram copiadas para este projeto.
- Confirme **separadamente** a licença do código/dados do `free-exercise-db`, a do repositório de tradução `gugeldev/exercicios-bd-ptbr` e a das imagens, lendo os arquivos `LICENSE`/README de cada um. Este projeto não presume que a licença dos textos traduzidos cubra as imagens (nem o contrário). Se o tráfego crescer, hospede as imagens numa CDN própria **somente** se a licença permitir a redistribuição, mantendo a atribuição exigida.
