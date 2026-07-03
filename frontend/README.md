# FitTrack Frontend

Frontend da aplicação **FitTrack**, desenvolvido com Next.js, React e TypeScript.

O sistema permite que usuários criem uma conta, façam login e gerenciem seus treinos, exercícios, séries, cargas e repetições por meio de um dashboard responsivo.

---

## Tecnologias utilizadas

- Next.js
- React
- TypeScript
- Axios
- CSS Modules
- LocalStorage
- JWT
- Git
- GitHub

---

## Funcionalidades

- Cadastro de usuário
- Login com autenticação JWT
- Proteção da página de dashboard
- Logout
- Listagem de treinos
- Cadastro de treinos
- Edição de treinos
- Exclusão de treinos
- Cadastro de exercícios
- Cadastro de séries
- Registro de peso
- Registro de repetições
- Dashboard responsivo
- Integração com API REST

---

## Estrutura principal

```txt
frontend
│
├── app
│   ├── dashboard
│   │   ├── dashboard.module.css
│   │   └── page.tsx
│   │
│   ├── register
│   │   └── page.tsx
│   │
│   ├── page.module.css
│   ├── page.tsx
│   └── layout.tsx
│
├── services
│   └── api.ts
│
├── public
├── package.json
└── README.md
```

---

## Páginas da aplicação

### Login

Rota:

```txt
/
```

Permite que o usuário informe e-mail e senha.

Após a autenticação, o token JWT retornado pela API é armazenado no `localStorage`.

---

### Cadastro

Rota:

```txt
/register
```

Permite criar um novo usuário informando:

- Nome
- E-mail
- Senha

Após o cadastro, o usuário é redirecionado para a tela de login.

---

### Dashboard

Rota:

```txt
/dashboard
```

O dashboard permite:

- Visualizar os treinos cadastrados
- Criar novos treinos
- Adicionar exercícios
- Adicionar séries
- Informar peso
- Informar repetições
- Editar treinos
- Excluir treinos
- Sair da aplicação

A página verifica se existe um token JWT no navegador. Caso não exista, o usuário é redirecionado para a página de login.

---

## Integração com a API

A comunicação com o backend é feita por meio do Axios.

Arquivo:

```txt
services/api.ts
```

Exemplo:

```ts
import axios from 'axios';

export const api = axios.create({
  baseURL: 'http://localhost:3000',
});

api.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('token');

    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  }

  return config;
});
```

O interceptor adiciona automaticamente o token JWT no header das requisições:

```txt
Authorization: Bearer TOKEN
```

---

## Pré-requisitos

Antes de executar o frontend, é necessário ter instalado:

- Node.js
- npm
- Backend FitTrack em execução

O backend deve estar disponível em:

```txt
http://localhost:3000
```

---

## Instalação

Entre na pasta do frontend:

```bash
cd frontend
```

Instale as dependências:

```bash
npm install
```

---

## Executando o projeto

Como o backend utiliza a porta `3000`, execute o frontend na porta `3001`:

```bash
npm run dev -- -p 3001
```

A aplicação ficará disponível em:

```txt
http://localhost:3001
```

---

## Rotas utilizadas no backend

### Autenticação

```txt
POST /auth/login
```

### Usuários

```txt
POST /users
```

### Treinos

```txt
GET /workouts
POST /workouts
GET /workouts/:id
PATCH /workouts/:id
DELETE /workouts/:id
```

---

## Exemplo de treino enviado para a API

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
    }
  ]
}
```

---

## Segurança no frontend

O frontend utiliza algumas medidas de controle de acesso:

- Armazenamento do token JWT no `localStorage`
- Envio automático do token no header `Authorization`
- Redirecionamento para o login quando não existe token
- Logout com remoção do token
- Acesso às rotas de treino somente após autenticação

A validação real das permissões é feita pelo backend com JWT e `AuthGuard`.

---

## Modelo de renderização

O projeto utiliza **Client-Side Rendering — CSR**.

As páginas de login, cadastro e dashboard utilizam:

```ts
'use client';
```

Essa escolha foi feita porque a aplicação possui:

- Alta interatividade
- Formulários
- Autenticação
- Estado local
- Requisições para API REST
- Atualização dinâmica de dados

---

## Responsividade

O dashboard possui estilos adaptados para diferentes tamanhos de tela.

Foram utilizados media queries para melhorar a visualização em:

- Computadores
- Tablets
- Celulares

---

## Fluxo da aplicação

```txt
Cadastro
   ↓
Login
   ↓
Token JWT
   ↓
Dashboard
   ↓
Criar treino
   ↓
Adicionar exercícios
   ↓
Adicionar séries
   ↓
Editar ou excluir
   ↓
Logout
```

---

## Scripts disponíveis

Executar em desenvolvimento:

```bash
npm run dev
```

Executar na porta `3001`:

```bash
npm run dev -- -p 3001
```

Gerar build:

```bash
npm run build
```

Executar build de produção:

```bash
npm run start
```

Verificar problemas de código:

```bash
npm run lint
```

---

## Autor

Douglas Rodrigues

Projeto desenvolvido para fins acadêmicos na disciplina de Arquitetura de Software e Frameworks.