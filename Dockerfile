FROM nginx:stable-alpine3.23-perl

COPY infra/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY favicon.ico index.html style.css main.js /usr/share/nginx/html/
COPY assets/ /usr/share/nginx/html/assets/

CMD ["nginx", "-g", "daemon off;"]
