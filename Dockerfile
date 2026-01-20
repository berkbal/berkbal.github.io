FROM nginx:stable-alpine3.23-perl

COPY . /usr/share/nginx/html

CMD ["nginx", "-g", "daemon off;"]
