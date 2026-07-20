FROM mariadb:11.8.6@sha256:78a5047d3ba33975f183f183c2464cc7f1eab13ec8667e57cc9a5821d6da7577

USER root
COPY --chmod=0644 my.cnf /etc/mysql/conf.d/my.cnf

ARG MYSQL_DATABASE=default_database
ARG MYSQL_USER=default_user
ARG MYSQL_PASSWORD=secret
ARG MYSQL_ROOT_PASSWORD=root

ENV MYSQL_DATABASE=$MYSQL_DATABASE
ENV MYSQL_USER=$MYSQL_USER
ENV MYSQL_PASSWORD=$MYSQL_PASSWORD
ENV MYSQL_ROOT_PASSWORD=$MYSQL_ROOT_PASSWORD

# Copy init sql file with env vars and then the script will substitute the variables.
COPY ./init.sql /scripts/init.template.sql
COPY ./docker-entrypoint.sh /docker-entrypoint-initdb.d/docker-initialize.sh

# The scripts in the `docker-entrypoint-initdb.d/` directory are executed as
# the mysql user inside the MySQL Docker container.
RUN chown -R mysql:root /docker-entrypoint-initdb.d
RUN chown -R mysql:root /scripts

CMD ["mariadbd"]
EXPOSE 3306
