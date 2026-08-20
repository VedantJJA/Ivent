# Deploying Ivent to Render (render.com)

This project is pre-configured with a `render.yaml` Blueprint for automated one-click deployment.

---

## Method 1: Automated Blueprint Deployment (Recommended)

1. Push this repository to GitHub or GitLab.
2. Log into [Render](https://dashboard.render.com).
3. Click **New +** and select **Blueprint**.
4. Connect your GitHub repository.
5. Render will automatically detect `render.yaml` and configure:
   - **ivent-db**: Managed PostgreSQL database.
   - **ivent-api**: Express + Socket.io backend on Node.js (auto-initializes tables and seeds clubs).
   - **ivent-client**: Next.js App Router frontend on Node.js.
6. Click **Apply**. Render will provision the database, backend, and frontend and link all environment variables automatically.

---

## Method 2: Manual Deployment via Render Dashboard

If you prefer to configure each service individually:

### 1. Create PostgreSQL Database
- Name: `ivent-db`
- Database Name: `ivent`
- User: `ivent_user`
- Plan: Free
- Copy the **Internal Database URL** once created.

### 2. Create Express Backend Web Service
- Name: `ivent-api`
- Root Directory: `server`
- Environment: `Node`
- Build Command: `npm install`
- Start Command: `npm start`
- Environment Variables:
  - `DATABASE_URL`: *(Paste your Render PostgreSQL connection string)*
  - `JWT_SECRET`: *(Any random 32+ character string)*
  - `ADMIN_EMAIL`: `vedantjja@gmail.com`
  - `CLIENT_URL`: `https://your-frontend-name.onrender.com`

### 3. Create Next.js Frontend Web Service
- Name: `ivent-client`
- Root Directory: `client`
- Environment: `Node`
- Build Command: `npm install && npm run build`
- Start Command: `npm start`
- Environment Variables:
  - `NEXT_PUBLIC_API_URL`: `https://your-backend-name.onrender.com`

---

## Features Handled Automatically on Render
- **Automatic Database Migration**: The server auto-executes `schema.sql` and seeds default clubs on startup.
- **SSL Auto-Negotiation**: Remote PostgreSQL SSL is automatically configured for Render databases.
- **Dynamic CORS**: Supports requests from any `.onrender.com` subdomain and configured client domains.
