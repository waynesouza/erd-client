# Multi-stage build para otimização
# Stage 1: Build da aplicação Angular
FROM node:16-alpine AS build

# Definir diretório de trabalho
WORKDIR /app

# Copiar arquivos de configuração do package
COPY package*.json ./

# Instalar dependências (incluindo dev para build)
RUN npm ci --silent

# Copiar código fonte
COPY . .

# Build da aplicação para produção
RUN npm run build

# Stage 2: Servir a aplicação com nginx
FROM nginx:alpine

# Copiar template do nginx (o entrypoint da imagem expande as variáveis no startup)
COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template

# BACKEND_URL aponta para o serviço do docker-compose por padrão e é sobrescrito no deploy.
# O resolver local é necessário porque o upstream do proxy fica em uma variável.
ENV BACKEND_URL=http://erd-core:8080 \
    NGINX_ENTRYPOINT_LOCAL_RESOLVERS=1 \
    NGINX_ENVSUBST_FILTER="^(BACKEND_URL|NGINX_LOCAL_RESOLVERS)$"

# Copiar arquivos buildados do stage anterior
COPY --from=build /app/dist/erd_frontend /usr/share/nginx/html

# Expor porta 80
EXPOSE 80

# Comando padrão
CMD ["nginx", "-g", "daemon off;"] 