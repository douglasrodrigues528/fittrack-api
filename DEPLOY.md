# Publicação do FitTrack (planos gratuitos)

Arquitetura: **Vercel** (frontend Next.js) → **Render** (API NestJS) → **Neon** (PostgreSQL).
Uso do projeto: acadêmico, pessoal e não comercial. Node.js **22** em todos os serviços.

```
Navegador ──HTTPS──▶ Vercel  https://<app>.vercel.app      (páginas estáticas; o endereço da API entra no build)
    └──HTTPS + JWT──▶ Render https://<api>.onrender.com    (única peça que acessa o banco)
                          └──TLS──▶ Neon  <endpoint>.us-east-1.aws.neon.tech
Imagens do catálogo ◀── raw.githubusercontent.com/yuhonas/free-exercise-db (seção 9)
```

Regiões: Render em **Virginia (US East)** e Neon em **AWS us-east-1**, juntos para a API não pagar latência a cada consulta.

## 1. Antes de publicar

- [ ] Na raiz: `npm test`, `npm run build`. Em `frontend/`: `npm test`, `npm run typecheck`, `npm run lint` e `NEXT_PUBLIC_API_URL=http://localhost:3000 npm run build`.
- [ ] Nenhum `.env` no Git: `git ls-files | grep -i "\.env"` lista só os `*.env.example`.
- [ ] Segredos que já apareceram no histórico (`DB_PASSWORD=123456`, `JWT_SECRET=jwt-secret-key`) não são usados em lugar nenhum.
- [ ] Arquivo do catálogo presente em `data/exercises/exercises-ptbr-full-translation.json` (fora do Git; seção 4).
- [ ] Verificação em duas etapas ligada nas contas do GitHub, Neon, Render e Vercel.

## 2. Variáveis de ambiente

| Variável | Onde | Obrigatória | Observação |
|---|---|---|---|
| `NODE_ENV` | Render | sim | `production` |
| `DATABASE_URL` | Render; no terminal só durante a seção 4 | sim | **segredo**; conexão direta do Neon (sem `-pooler`) |
| `DB_SSL` | Render e terminal | sim | `true` |
| `DB_SYNCHRONIZE` | Render | sim | `false` (o esquema vem só das migrations) |
| `JWT_SECRET` | Render | sim | **segredo**; ≥ 32 caracteres. Gere localmente: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` e cole direto no painel. Sem ele a API não sobe |
| `CORS_ORIGINS` | Render | sim | `https://<app>.vercel.app`, exato, sem barra final (vários: separados por vírgula) |
| `TRUST_PROXY` | Render | sim | `1`: IP real do cliente, necessário para os limites por IP de login e de cadastro |
| `ENABLE_SWAGGER` | Render | não | deixe `false` ou ausente |
| `SIGNUP_LIMIT_PER_HOUR` | Render | não | deixe **ausente** (padrão: 5 contas por IP por hora) |
| `EXERCISE_IMAGES_BASE_URL` | Render | não | deixe ausente (mantém as URLs atuais das imagens) |
| `PORT` | — | não defina | o Render fornece |
| `NEXT_PUBLIC_API_URL` | Vercel (Production) | sim | `https://<api>.onrender.com`. **Pública**: fica visível no navegador. Sem ela o build falha |
| `CONFIRM_DB_HOST` | só no terminal (seção 4) | sim | o host do Neon, digitado por você para confirmar o destino |

Segredos nunca vão para arquivos, commits, chats ou prints. No terminal, a `DATABASE_URL` vale só para a sessão aberta (seção 4.1).

## 3. Neon

1. Entre com o GitHub e crie o projeto `fittrack`: Postgres 17, região **AWS US East (N. Virginia) — us-east-1**. Banco padrão `neondb`, papel `neondb_owner`.
2. Compute: deixe o máximo de autoscaling baixo (0,25–0,5 CU) para poupar a cota. A suspensão por inatividade (5 min) é automática.
3. Em **Connect**, copie a connection string **direta** (host sem `-pooler`). Ela vem com `sslmode=require&channel_binding=require`.
4. SSL, como a API trata a string:
   - os parâmetros de SSL saem da URL e viram opções explícitas: **o certificado do servidor é sempre validado** (`rejectUnauthorized: true`). O Neon usa certificado de autoridade pública, aceito pelo Node;
   - `sslmode=no-verify` e `uselibpqcompat` são recusados (desligariam a validação);
   - `channel_binding=require` liga o channel binding do SCRAM na biblioteca `pg` (`enableChannelBinding`). Observação: a `pg` usa o channel binding quando o servidor o oferece, mas não recusa sozinha um servidor que não ofereça; o SSL validado continua obrigatório de qualquer forma.
5. O primeiro contato com o banco é a **simulação** da seção 4.2: só leitura, numa transação `READ ONLY`, e confirma conexão, SSL ativo, versão e banco vazio.

## 4. Banco de produção: migrations e catálogo

O Render gratuito não tem comando de pré-deploy nem shell: estes passos rodam **da sua máquina**, na raiz do projeto, com os comandos protegidos `db:prod:migrate` e `db:prod:catalog`. Eles:

- leem `DATABASE_URL` **só** do ambiente do terminal; o `.env` nunca é usado como destino (é lido apenas para recusar o banco de desenvolvimento);
- recusam host local, o host do `.env` e o banco de desenvolvimento;
- mostram host, porta, banco e usuário, **nunca a senha**;
- exigem `CONFIRM_DB_HOST` idêntico ao host da URL e SSL obrigatório fora do ensaio local;
- conferem que a conexão está mesmo com SSL (`pg_stat_ssl`) e o estado do banco; estado desconhecido ou inconsistente aborta;
- **simulam por padrão** (`--dry-run`); só gravam com `--apply` **e** a palavra `APLICAR` digitada.

### 4.1 Preparar o terminal (PowerShell)

```powershell
npm ci --include=dev
npm run build                     # gera dist/, onde estão os comandos protegidos
$s = Read-Host 'DATABASE_URL do Neon' -AsSecureString
$env:DATABASE_URL = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))
$env:DB_SSL = 'true'
$env:CONFIRM_DB_HOST = '<host do Neon, ex.: ep-xxxx.us-east-1.aws.neon.tech>'
```

### 4.2 Sequência

1. **Teste de leitura** (nada é gravado): `npm run db:prod:migrate`
   Esperado: destino correto, `SSL ativo: sim`, `Tabelas: (nenhuma)`, 3 migrations pendentes.
2. **Branch de segurança** no painel do Neon (Branches → Create branch, ex.: `antes-migrations`).
3. **Migrations**: `npm run db:prod:migrate -- --apply` e digite `APLICAR`.
   As 3 migrations rodam numa única transação. Esperado: `Migrations aplicadas: JourneyAndSessions…, CascadeWorkoutsOnUserDelete…, AddUserTokenVersion…`. Repetir a simulação deve dizer `Nada a aplicar`.
4. **Catálogo (simulação)**: `npm run db:prod:catalog`
   Esperado: `Catálogo: 873 exercícios · SHA-256 23d10d10…983a (confere)` e `Plano: 873 a inserir`.
5. **Catálogo**: `npm run db:prod:catalog -- --apply` e digite `APLICAR`. Esperado: `Catálogo importado: 873 exercícios.`
6. Feche o terminal (ou `Remove-Item Env:DATABASE_URL, Env:CONFIRM_DB_HOST`).

### 4.3 Catálogo: arquivo validado

- Fonte: `data/exercises/exercises-ptbr-full-translation.json` (local, **fora do Git**). Nada é baixado na hora.
- Impressão digital registrada em `src/infra/database/production/catalog.ts`: SHA-256 `23d10d108bb811eb4daacdce611a7b28428a3ef03e6af817b73eddca792c983a`, **exatamente 873** exercícios, IDs únicos, nome e imagens obrigatórios.
- A importação roda numa transação: se a contagem final não for 873, nada é gravado. Repetir é seguro (atualiza os mesmos 873).
- As imagens ficam como no arquivo (caminhos `<id>/<n>.jpg`, 1.746 no total); a API monta as URLs como sempre (seção 9).
- `node scripts/sync-exercises.cjs` é **só para o banco local de desenvolvimento** (baixa a versão mais recente da fonte) e recusa destino remoto.

### 4.4 Ensaio local (repetível)

Num banco descartável terminado em `_test` (nunca o do `.env`), numa cópia limpa do projeto:

```bash
NODE_ENV=production npm ci --include=dev && npm run build
DATABASE_URL=postgres://…@localhost:5432/fittrack_deploy_test CONFIRM_DB_HOST=localhost \
  npm run db:prod:migrate -- --apply --allow-local-test
… npm run db:prod:catalog -- --apply --allow-local-test --file=<caminho do JSON>
NODE_ENV=production DATABASE_URL=… JWT_SECRET=… CORS_ORIGINS=… npm run start:prod
```

`--allow-local-test` só vale para host local e banco `_test`; não vale para o host remoto.

## 5. API no Render (Web Service, Free)

| Campo | Valor |
|---|---|
| Repositório / branch | `douglasrodrigues528/fittrack-api` / `main` |
| Root Directory | vazio (a API está na raiz) |
| Runtime / região | Node / Virginia (US East) |
| Build Command | `npm ci --include=dev && npm run build` |
| Start Command | `npm run start:prod` (executa `node dist/main`) |
| Versão do Node | 22.x (`engines` no `package.json`) |
| Health Check Path | `/health` |
| Auto-Deploy | desligado no início (deploy manual) |
| Variáveis | seção 2 |

- `--include=dev` é necessário: com `NODE_ENV=production` o `npm ci` pula as dependências de desenvolvimento e o `nest build` (que depende do `@nestjs/cli`) falha.
- `/health` responde `{"status":"ok"}` **sem consultar o banco**: as checagens do Render não mantêm o Neon acordado nem gastam a cota dele. Para conferir o banco: `GET /exercises?limit=1` (total 873).
- Migrations novas em deploys futuros: rode a seção 4 **antes** de publicar a API que depende delas.

## 6. Frontend na Vercel (Hobby)

| Campo | Valor |
|---|---|
| Framework | Next.js (detectado) |
| Root Directory | `frontend` |
| Install / Build | `npm ci` / `npm run build` |
| Node.js | 22.x (`engines` em `frontend/package.json`) |
| Variável | `NEXT_PUBLIC_API_URL=https://<api>.onrender.com` no ambiente **Production** |

- O endereço entra no código **durante o build**: trocar a variável exige novo deploy.
- Sem a variável o build **falha** com mensagem clara (não usa `localhost` em silêncio). Na produção da Vercel ela também precisa ser `https` e não pode apontar para `localhost`.
- Previews: cada push gera um deploy de preview com outro endereço. Sem `NEXT_PUBLIC_API_URL` no ambiente Preview o build de preview falha; com ela, o CORS da API recusa a origem do preview. Desligue os previews ou aceite que eles não acessam a API.
- Cabeçalhos em todas as páginas: `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`, sem `X-Powered-By`. CSP ainda não (exige análise das imagens e fontes).

## 7. Ordem de publicação

1. Neon: projeto → teste de leitura → branch de segurança → migrations → catálogo (seção 4).
2. Render: serviço com as variáveis; conferir `GET /health` (200) e `GET /exercises?limit=1` (873).
3. Vercel: projeto com `NEXT_PUBLIC_API_URL`; o app abre e as chamadas vão para `onrender.com`.
4. Render: `CORS_ORIGINS` com o domínio final da Vercel e novo deploy; login pelo navegador funciona.
5. Homologação com contas fictícias (`@exemplo.test`): cadastro, login, rotinas e limite de 7, treino, histórico, calendário, catálogo, evolução, sugestão de carga, isolamento entre usuários. No fim, exclua as contas de teste.

## 8. Limitações do plano gratuito

- **Render Free**: dorme após 15 min sem tráfego; acordar leva cerca de 1 minuto. 750 horas por mês por conta: uma API sempre ligada cabe, mas não sobra para outra. Esgotadas, os serviços gratuitos param até o mês seguinte. O app mostra "Conectando ao servidor…" quando uma requisição passa de 4 s.
- **Neon Free**: 100 CU-hora por projeto por mês, suspensão após 5 min, 1 GB de armazenamento e 5 GB de tráfego por mês. Ao esgotar processamento ou tráfego, o banco fica suspenso até o mês seguinte; sem armazenamento, gravações falham. Nada é cobrado nem apagado.
- **Vercel Hobby**: uso pessoal e não comercial. Confira banda e minutos de build no painel de uso.
- **Estado em memória**: cache e contadores de login e de cadastro valem para uma instância só e zeram quando a API dorme ou reinicia.
- Não use pings externos para manter a API acordada: gastam quase todas as horas do mês.

Limites conferidos em novembro de 2026 em render.com/docs/free, neon.com/docs/introduction/plans e vercel.com/pricing; confira de novo antes de publicar.

## 9. Catálogo: origem, créditos e direitos das imagens

| Fonte | Uso no FitTrack | Licença declarada pela fonte |
|---|---|---|
| [gugeldev/exercicios-bd-ptbr](https://github.com/gugeldev/exercicios-bd-ptbr) (`exercises/exercises-ptbr-full-translation.json`) | textos traduzidos dos 873 exercícios | CC0 1.0 (arquivo `LICENSE`); o README informa que as imagens não estão incluídas |
| [yuhonas/free-exercise-db](https://github.com/yuhonas/free-exercise-db) (`exercises/<id>/<n>.jpg`) | **imagens**, carregadas direto do GitHub | The Unlicense (`LICENSE.md`) |
| [wrkout/exercises.json](https://github.com/wrkout/exercises.json) | origem dos dados e das imagens do free-exercise-db | The Unlicense |

Créditos: tradução por gugeldev/exercicios-bd-ptbr; base e imagens por yuhonas/free-exercise-db, a partir de wrkout/exercises.json (Ollie Jennings).

**Ressalva sobre as fotografias (pendência documental em aberto):** as três fontes se declaram de domínio público, mas **nenhuma delas informa quem fez as fotografias nem documenta que o autor autorizou esse uso**. Uma licença declarada num repositório não comprova os direitos sobre fotos de terceiros. Por decisão do projeto (uso acadêmico, pessoal e não comercial), as imagens atuais são mantidas, sem cópia para este repositório e com as URLs de sempre (`EXERCISE_IMAGES_BASE_URL`, padrão `https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises`). **Esta documentação não afirma que a autorização de uso está comprovada.** Se a origem das fotos for esclarecida, atualize esta seção; se surgir qualquer contestação, as imagens podem ser retiradas mudando só essa variável, sem tocar nos dados.

## 10. Reversão

- **Frontend**: Instant Rollback da Vercel (volta ao deploy de produção anterior; no Hobby, ao menos o imediatamente anterior) ou reverter o commit por PR.
- **API**: Rollback do Render para um deploy anterior. Com Auto-Deploy desligado nada entra no ar sem você escolher. As migrations atuais só acrescentam estruturas: uma API anterior roda sobre o esquema novo.
- **Banco**: branch do Neon antes de cada migration ou carga (restauração instantânea). A restauração de um ponto no tempo do plano gratuito tem janela curta: confira no painel e não conte só com ela. Não rode `migration:revert` em produção sem branch de segurança. Se um comando protegido falhar, ele aborta: restaure o branch e corrija com uma nova migration.
- **Credencial vazada**: troque a senha no Neon (Reset password) e atualize `DATABASE_URL` no Render; troque `JWT_SECRET` (todos os usuários precisam entrar de novo).
- **Tirar do ar**: suspenda o serviço no Render.

## 11. Segurança: estado atual e pendências

Já feito: segredo JWT obrigatório em produção; token vale 1 dia e é invalidado ao trocar a senha (`users.tokenVersion`); limite de tentativas de login (5 por conta e 50 por IP em 15 min); **limite de cadastro de 5 contas por IP por hora** (429 com `Retry-After`; depende de `TRUST_PROXY=1`); CORS só para as origens configuradas; Swagger desligado em produção; cada usuário só acessa os próprios dados; `synchronize` desligado em produção; SSL do banco com certificado validado; cabeçalhos de segurança na API (`nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`, sem `X-Powered-By`) e no frontend; excluir a conta apaga rotinas, sessões e séries.

Pendente: JWT em `localStorage` (um XSS roubaria o token; o ideal é cookie `HttpOnly`); CSP; política de senha mais forte; contadores e cache em memória (com mais de uma instância seria preciso Redis); logs estruturados e monitoramento de erros.
