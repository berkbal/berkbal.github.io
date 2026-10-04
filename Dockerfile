FROM nginx:stable-alpine3.23-perl

COPY favicon.ico index.html style.css main.js /usr/share/nginx/html/
COPY assets/ /usr/share/nginx/html/assets/

CMD ["nginx", "-g", "daemon off;"]
