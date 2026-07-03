# FitTrack API

Backend da aplicação **FitTrack**, desenvolvido com NestJS, TypeScript, PostgreSQL e TypeORM.

A API permite o gerenciamento de usuários, autenticação e controle completo de treinos, incluindo exercícios, séries, peso e repetições.

---

## 📌 Sobre o projeto

O FitTrack é uma aplicação full stack voltada para a organização de treinos físicos.

O backend é responsável por:

- Cadastro de usuários
- Autenticação com JWT
- Criptografia de senhas
- Gerenciamento de treinos
- Armazenamento de exercícios e séries
- Isolamento de dados por usuário
- Validação de requisições
- Cache em memória
- Persistência no PostgreSQL
- Documentação automática com Swagger

---

# 🚀 Tecnologias utilizadas

## Backend

- NestJS
- Node.js
- TypeScript

## Banco de dados

- PostgreSQL
- TypeORM
- JSONB

## Segurança

- JWT
- Passport JWT
- BCrypt
- AuthGuard
- ValidationPipe
- CORS

## Performance

- Cache Manager

## Documentação

- Swagger

## Testes

- Jest

## Versionamento

- Git
- GitHub

---

# 🏗️ Arquitetura

O projeto utiliza uma arquitetura em camadas, separando responsabilidades para facilitar manutenção, testes, organização e evolução da aplicação.

```txt
Presentation Layer
        ↓
Application Layer
        ↓
Infrastructure Layer
        ↓
Database Layer
```

## Camadas

### Presentation

Responsável pela comunicação com o cliente.

Contém:

- Controllers
- Modules
- Recebimento das requisições HTTP
- Retorno das respostas da API

### Application

Responsável pelas regras da aplicação.

Contém:

- Services
- DTOs
- Regras de negócio
- Validação de dados

### Infrastructure

Responsável pela integração com recursos externos.

Contém:

- Entidades do TypeORM
- Configuração do PostgreSQL
- Persistência dos dados

### Shared

Contém recursos compartilhados pela aplicação.

Exemplo:

- Decorator `CurrentUser`

---

## Estrutura de pastas

```txt
src
├── application
│   ├── dto
│   └── services
│
├── infra
│   └── database
│       └── entities
│
├── presentation
│   ├── controllers
│   └── modules
│
├── shared
│   └── decorators
│
├── app.module.ts
└── main.ts
```

---

# 🗄️ Modelagem de dados

## User

Representa um usuário cadastrado no sistema.

Principais campos:

```txt
id
name
email
password
createdAt
```

A senha é armazenada de forma criptografada utilizando BCrypt.

---

## Workout

Representa um treino pertencente a um usuário.

Principais campos:

```txt
id
title
description
exercises
userId
createdAt
```

O campo `exercises` utiliza o tipo `JSONB` do PostgreSQL.

Essa escolha permite armazenar uma estrutura flexível contendo exercícios e suas respectivas séries.

Exemplo:

```json
[
  {
    "name": "Supino reto",
    "sets": [
      {
        "weight": 40,
        "reps": 12
      },
      {
        "weight": 45,
        "reps": 10
      }
    ]
  }
]
```

---

## Relacionamento

O relacionamento entre usuários e treinos é:

```txt
User 1 ─────────── N Workout
```

Um usuário pode possuir vários treinos.

Cada treino pertence a apenas um usuário.

---

# 🔐 Autenticação

A autenticação é realizada utilizando JWT — JSON Web Token.

## Fluxo de autenticação

```txt
Usuário envia e-mail e senha
            ↓
Backend busca o usuário
            ↓
BCrypt compara a senha
            ↓
Backend gera um token JWT
            ↓
Cliente envia o token nas próximas requisições
            ↓
AuthGuard protege as rotas privadas
```

O token deve ser enviado no header:

```http
Authorization: Bearer SEU_TOKEN
```

---

# 🔒 Segurança

## BCrypt

Antes de salvar uma senha, a API gera um hash utilizando BCrypt.

```ts
const hashedPassword = await bcrypt.hash(data.password, 10);
```

A senha original não é armazenada no banco de dados.

---

## JWT

Após o login, a API retorna um token JWT.

Esse token identifica o usuário autenticado e permite acessar as rotas protegidas.

---

## AuthGuard

As rotas privadas utilizam:

```ts
@UseGuards(AuthGuard('jwt'))
```

Isso impede o acesso sem um token JWT válido.

---

## Isolamento de dados

Os treinos são consultados utilizando o identificador do usuário autenticado:

```ts
where: {
  userId,
}
```

Dessa forma, um usuário não pode acessar os treinos de outro usuário.

---

## ValidationPipe

A aplicação utiliza validação global:

```ts
app.useGlobalPipes(
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }),
);
```

Essa configuração:

- Remove campos não permitidos
- Rejeita propriedades desconhecidas
- Converte dados para os tipos definidos nos DTOs
- Valida o formato das requisições

---

## CORS

O CORS permite que o frontend se comunique com o backend mesmo estando em uma origem diferente.

Durante o desenvolvimento:

```txt
Frontend: http://localhost:3001
Backend: http://localhost:3000
```

A configuração também permite o header `Authorization`, utilizado para enviar o token JWT.

---

# 📦 Funcionalidades

## 👤 Users

### Criar usuário

```http
POST /users
```

Essa rota é pública para permitir o cadastro.

### Listar usuários

```http
GET /users
```

### Buscar usuário por ID

```http
GET /users/:id
```

### Atualizar usuário

```http
PATCH /users/:id
```

### Remover usuário

```http
DELETE /users/:id
```

As rotas de listagem, consulta, atualização e exclusão são protegidas por autenticação.

---

## 🔑 Auth

### Login

```http
POST /auth/login
```

Exemplo de requisição:

```json
{
  "email": "usuario@email.com",
  "password": "123456"
}
```

Exemplo de resposta:

```json
{
  "access_token": "TOKEN_JWT"
}
```

---

## 🏋️ Workouts

Todas as rotas de treinos exigem autenticação JWT.

### Criar treino

```http
POST /workouts
```

### Listar treinos

```http
GET /workouts
```

### Buscar treino por ID

```http
GET /workouts/:id
```

### Atualizar treino

```http
PATCH /workouts/:id
```

### Remover treino

```http
DELETE /workouts/:id
```

---

## Exemplo de criação de treino

```json
{
  "title": "Treino de Peito",
  "description": "Treino com foco em força",
  "exercises": [
    {
      "name": "Supino reto",
      "sets": [
        {
          "weight": 40,
          "reps": 12
        },
        {
          "weight": 45,
          "reps": 10
        }
      ]
    },
    {
      "name": "Crucifixo",
      "sets": [
        {
          "weight": 15,
          "reps": 12
        }
      ]
    }
  ]
}
```

---

# 🧠 Cache

Foi implementado cache em memória na listagem de treinos:

```http
GET /workouts
```

## Objetivos

- Reduzir consultas repetidas ao PostgreSQL
- Melhorar o tempo de resposta
- Reduzir processamento desnecessário
- Demonstrar uma estratégia de otimização arquitetural

---

## Cache por usuário

Cada usuário possui uma chave de cache diferente:

```txt
workouts:USER_ID
```

Exemplo:

```txt
workouts:550e8400-e29b-41d4-a716-446655440000
```

Isso evita que os dados de usuários diferentes sejam misturados.

---

## Funcionamento

```txt
Primeira consulta
        ↓
Busca no PostgreSQL
        ↓
Dados armazenados no cache
        ↓
Próxima consulta
        ↓
Resposta retornada pelo cache
```

---

## Invalidação do cache

O cache é apagado automaticamente quando:

- Um treino é criado
- Um treino é atualizado
- Um treino é removido

Exemplo:

```ts
await this.cacheManager.del(`workouts:${userId}`);
```

Depois da invalidação, a próxima consulta busca novamente os dados atualizados no banco.

---

## Tempo de duração

O cache pode permanecer armazenado por até 600 segundos:

```txt
600 segundos = 10 minutos
```

Mesmo com esse tempo, alterações feitas pelo usuário não permanecem desatualizadas, pois o cache é invalidado após operações de criação, edição e exclusão.

---

# 📖 Swagger

A documentação da API pode ser acessada em:

```txt
http://localhost:3000/docs
```

O Swagger permite:

- Visualizar os endpoints
- Consultar os DTOs
- Testar requisições
- Visualizar respostas
- Informar o token JWT
- Testar as rotas protegidas

Para acessar as rotas protegidas:

1. Execute o endpoint de login
2. Copie o `access_token`
3. Clique em `Authorize`
4. Informe:

```txt
Bearer SEU_TOKEN
```

---

# 🧪 Testes

O projeto utiliza Jest para testes automatizados.

Executar os testes:

```bash
npm test
```

Executar os testes em modo de observação:

```bash
npm run test:watch
```

Executar relatório de cobertura:

```bash
npm run test:cov
```

Os testes devem validar regras como:

- Criação de usuário
- Listagem de usuários
- Impedimento de e-mail duplicado
- Regras dos serviços

---

# ⚙️ Como executar o projeto

## 1. Clonar o repositório

```bash
git clone https://github.com/douglasrodrigues528/fittrack-api.git
```

Entre na pasta:

```bash
cd fittrack-api
```

---

## 2. Instalar as dependências

```bash
npm install
```

---

## 3. Configurar o PostgreSQL

Crie um banco de dados chamado:

```txt
fittrack
```

---

## 4. Configurar as variáveis de ambiente

Crie um arquivo `.env` na raiz do projeto:

```env
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=123456
DB_NAME=fittrack
JWT_SECRET=jwt-secret-key
```

Ajuste os valores de acordo com sua instalação do PostgreSQL.

Não envie o arquivo `.env` para o GitHub.

---

## 5. Executar o projeto

Modo de desenvolvimento:

```bash
npm run start:dev
```

A API ficará disponível em:

```txt
http://localhost:3000
```

O Swagger ficará disponível em:

```txt
http://localhost:3000/docs
```

---

# 🔄 Integração com o frontend

O frontend deve estar executando em:

```txt
http://localhost:3001
```

Para iniciar o frontend:

```bash
cd frontend
npm install
npm run dev -- -p 3001
```

---

# 📌 Melhorias futuras

- Utilizar Redis como cache distribuído
- Adicionar Docker e Docker Compose
- Implementar migrations do TypeORM
- Realizar deploy em nuvem
- Implementar Refresh Token
- Adicionar recuperação de senha
- Adicionar testes E2E
- Criar gráficos de evolução de carga
- Adicionar histórico de treinos por data
- Desenvolver aplicativo mobile
- Implementar monitoramento com Prometheus e Grafana

---

# 👨‍💻 Autores

- Douglas Rodrigues
- Mauricio T. Welter

---

Projeto desenvolvido para fins acadêmicos na disciplina de Frameworks.