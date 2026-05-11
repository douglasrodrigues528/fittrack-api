# FitTrack API

Backend desenvolvido com NestJS para gerenciamento de usuários e treinos físicos.

## 📌 Sobre o Projeto

O FitTrack API é uma aplicação backend desenvolvida com foco em organização de treinos físicos, autenticação segura de usuários e gerenciamento individual de dados.

O sistema permite:

- Cadastro de usuários
- Login com autenticação JWT
- Criação de treinos
- Listagem de treinos por usuário
- Atualização de treinos
- Remoção de treinos
- Proteção de rotas
- Cache em memória
- Documentação automática com Swagger
- Testes automatizados com Jest

---

# 🚀 Tecnologias Utilizadas

## Backend

- NestJS
- TypeScript
- Node.js

## Banco de Dados

- PostgreSQL
- TypeORM

## Segurança

- JWT Authentication
- bcrypt
- Passport JWT

## Documentação

- Swagger

## Testes

- Jest

## Versionamento

- Git
- GitHub

---

# 🏗️ Arquitetura

O projeto utiliza arquitetura em camadas, separando responsabilidades para facilitar manutenção, organização e escalabilidade.

```txt
Presentation Layer
↓
Application Layer
↓
Infrastructure Layer
↓
Database Layer
```

## Estrutura de Pastas

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
└── main.ts
```

---

# 🔐 Autenticação

A autenticação é realizada utilizando JWT (JSON Web Token).

Fluxo:

1. Usuário realiza login
2. API gera um token JWT
3. O token é enviado no header Authorization
4. Rotas protegidas validam o token

Exemplo:

```txt
Authorization: Bearer SEU_TOKEN
```

---

# 📦 Funcionalidades

## 👤 Users

### Criar usuário

```http
POST /users
```

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

---

## 🔑 Auth

### Login

```http
POST /auth/login
```

---

## 🏋️ Workouts

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

# 🧠 Cache

Foi implementado cache em memória na listagem de treinos.

Objetivos:

- Reduzir consultas repetidas ao banco
- Melhorar performance
- Demonstrar otimização arquitetural

O cache é invalidado automaticamente quando:

- Um treino é criado
- Um treino é atualizado
- Um treino é removido

---

# 📖 Swagger

A documentação da API pode ser acessada em:

```txt
http://localhost:3000/docs
```

O Swagger permite:

- Visualizar endpoints
- Testar requisições
- Validar DTOs
- Utilizar autenticação JWT

---

# 🧪 Testes

O projeto utiliza Jest para testes automatizados.

Foram implementados testes para:

- Listagem de usuários
- Criação de usuário
- Regra de e-mail duplicado

Executar testes:

```bash
npm test
```

---

# ⚙️ Como Executar o Projeto

## 1. Clonar repositório

```bash
git clone https://github.com/douglasrodrigues528/fittrack-api.git
```

---

## 2. Instalar dependências

```bash
npm install
```

---

## 3. Configurar variáveis de ambiente

Criar arquivo `.env`

```env
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=123456
DB_NAME=fittrack
JWT_SECRET=jwt-secret-key
```

---

## 4. Executar projeto

```bash
npm run start:dev
```

---

# 📌 Melhorias Futuras

- Redis
- Docker
- Deploy em nuvem
- Upload de imagens
- Refresh Token
- Testes E2E

---

# 👨‍💻 Autores

- Douglas Rodrigues 
- Mauricio T Welter

---

