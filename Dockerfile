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
RUN npm run build --configuration=production

# Stage 2: Servir a aplicação com nginx
FROM nginx:alpine

# Copiar configuração customizada do nginx
COPY nginx.conf /etc/nginx/nginx.conf

# Copiar arquivos buildados do stage anterior
COPY --from=build /app/dist/erd_frontend /usr/share/nginx/html

# Expor porta 80
EXPOSE 80

# Comando padrão
CMD ["nginx", "-g", "daemon off;"] 