ALTER TABLE orders ADD COLUMN performance_team_id uuid REFERENCES teams(id);
CREATE INDEX orders_performance_team_date ON orders(performance_team_id, business_date)
  WHERE performance_team_id IS NOT NULL;
