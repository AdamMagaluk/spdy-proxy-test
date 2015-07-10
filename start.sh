#!/bin/bash

for i in `seq 1 $1`;
do
    node server.js 0 $2 &
done

wait;
