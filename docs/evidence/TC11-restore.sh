#!/bin/bash
# Restores the journal line altered for the TC11 UI screenshot (seq 128, line jl_01M8AKADCJHVK4YJQPTT568FSM, original amount 79592500).
/opt/homebrew/opt/postgresql@15/bin/psql postgresql://hsg_owner:hsg_owner@localhost:5432/hsg -qc "begin; set local session_replication_role = replica; update journal_lines set amount = 79592500 where id = 'jl_01M8AKADCJHVK4YJQPTT568FSM'; commit;" && echo "restored seq 128 to 79592500"
